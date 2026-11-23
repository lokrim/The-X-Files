package expo.modules.p01b

import android.Manifest
import android.app.KeyguardManager
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.Handler
import android.os.HandlerThread
import android.os.IBinder
import android.os.PowerManager
import android.os.Process
import android.os.SystemClock
import android.util.Log
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.ReactContext
import com.facebook.react.bridge.LifecycleEventListener
import com.facebook.react.jstasks.HeadlessJsTaskConfig
import com.facebook.react.jstasks.HeadlessJsTaskContext
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.withTimeoutOrNull
import kotlinx.coroutines.yield
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream
import java.lang.ref.WeakReference
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicLong

// Diagnostic/test state only. None of this module enters normal autolinking.
object P01bState {
  val processStartedElapsedMs = Process.getStartElapsedRealtime()
  val running = AtomicBoolean(false)
  val sequence = AtomicLong(0)
  val workBytes = AtomicLong(0)
  private val fileLock = Any()
  @Volatile var generation = 0L
  @Volatile var react: WeakReference<ReactContext>? = null
  @Volatile var started = 0L
  private var startedUptime = 0L
  private var last = 0L
  private var maxGap = 0L
  private var nativeLast = 0L
  private var nativeMaxGap = 0L
  private var nativeTicks = 0L
  private var waitCalls = 0L
  private var waitReturns = 0L
  private var hostResumes = 0L
  private var hostPauses = 0L
  private var pending = false
  private var ready = CompletableDeferred<Boolean>()
  private var canceled = CompletableDeferred<Unit>()
  @Volatile var reason = "NONE"
  var scheduler = "js-timer"
  var headless = false
  var channel = "p01b-jobs"
  var timeoutCount = 0
  var timeoutStopMs = 0L
  @Volatile var cleanupAttempted = false
  @Volatile var cleanupComplete = false
  @Volatile private var owned: File? = null

  @Synchronized fun prepare(context: ReactContext, mode: String): Long {
    check(!pending && !running.get() && owned == null && !(cleanupAttempted && !cleanupComplete))
    generation++
    react = WeakReference(context)
    scheduler = mode
    pending = true
    ready = CompletableDeferred()
    canceled = CompletableDeferred()
    return generation
  }
  @Synchronized fun prepared(g: Long) = g == generation && pending
  @Synchronized fun begin(g: Long, directory: File, headlessTask: Boolean, channelId: String) {
    check(g == generation && pending)
    directory.mkdirs()
    val file = File.createTempFile("job-", ".partial", directory)
    started = SystemClock.elapsedRealtime(); startedUptime = SystemClock.uptimeMillis()
    last = started; nativeLast = started; maxGap = 0; nativeMaxGap = 0
    nativeTicks = 0; waitCalls = 0; waitReturns = 0; hostResumes = 0; hostPauses = 0
    sequence.set(0); workBytes.set(0)
    headless = headlessTask; channel = channelId; reason = "RUNNING"
    cleanupAttempted = false; cleanupComplete = false; owned = file
    pending = false; running.set(true)
  }
  @Synchronized fun markReady(g: Long) { if (active(g)) ready.complete(true) }
  @Synchronized fun lifecycle(g: Long, resumed: Boolean) {
    if (!active(g)) return
    if (resumed) hostResumes++ else hostPauses++
  }
  fun active(g: Long) = g == generation && running.get()
  @Synchronized fun poke(g: Long, n: Int): Boolean {
    if (!active(g)) return false
    val now = SystemClock.elapsedRealtime()
    maxGap = maxOf(maxGap, now - last); last = now; sequence.set(n.toLong())
    return true
  }
  @Synchronized fun heartbeat(g: Long): Boolean {
    if (!active(g)) return false
    val now = SystemClock.elapsedRealtime()
    nativeMaxGap = maxOf(nativeMaxGap, now - nativeLast); nativeLast = now; nativeTicks++
    // Includes a terminal JS stall even if no subsequent poke ever arrives.
    maxGap = maxOf(maxGap, now - last)
    return now - started < 600000L
  }
  @Synchronized fun cancel(g: Long, code: String): Boolean {
    if (g != generation) return false
    if (running.get() || pending) {
      reason = code
      if (started > 0) maxGap = maxOf(maxGap, SystemClock.elapsedRealtime() - last)
    }
    running.set(false); pending = false
    ready.complete(false); canceled.complete(Unit)
    return true
  }
  suspend fun awaitReady(g: Long): Boolean {
    val signal = synchronized(this) { if (g == generation) ready else null } ?: return false
    return withTimeoutOrNull(5000) { signal.await() } == true && active(g)
  }
  suspend fun waitForRecord(g: Long, milliseconds: Int): Boolean {
    val signal = synchronized(this) {
      if (!active(g)) null else { waitCalls++; canceled }
    } ?: return false
    // Native coroutine delays, never RN timers/Choreographer. No CPU wake guarantee.
    if (milliseconds == 0) yield()
    else withTimeoutOrNull(milliseconds.toLong()) { signal.await() }
    synchronized(this) { if (g == generation) waitReturns++ }
    return active(g)
  }
  fun write(g: Long, bytes: ByteArray): Int = synchronized(fileLock) {
    if (!active(g)) return@synchronized 0
    if (SystemClock.elapsedRealtime() - started >= 600000L || workBytes.get() + bytes.size > 2000000000L) {
      cancel(g, "TEST_LIMIT"); return@synchronized 0
    }
    val file = owned ?: return@synchronized 0
    FileOutputStream(file, true).use { it.write(bytes) }
    workBytes.addAndGet(bytes.size.toLong()); bytes.size
  }
  @Synchronized fun cleanup(g: Long) {
    if (g != generation || cleanupAttempted) return
    cleanupAttempted = true
    val file = owned; owned = null
    // Never await an in-flight write or JS on the main/timeout thread.
    Thread {
      val complete = synchronized(fileLock) {
        try { file == null || file.delete() || !file.exists() } catch (_: Exception) { false }
      }
      synchronized(this) { if (g == generation) cleanupComplete = complete }
    }.start()
  }
  fun snapshot(ctx: Context): Map<String, Any> {
    val manager = ctx.getSystemService(NotificationManager::class.java)
    val notifications = manager.activeNotifications.filter { it.id == 1901 }
    val power = ctx.getSystemService(PowerManager::class.java)
    val reactContext = react?.get()
    val now = SystemClock.elapsedRealtime()
    val uptime = SystemClock.uptimeMillis()
    val state = synchronized(this) {
      mapOf<String, Any>(
        "diagnosticsVersion" to 2,
        "generation" to generation, "processStartedElapsedMs" to processStartedElapsedMs,
        "running" to running.get(), "sequence" to sequence.get(), "workBytes" to workBytes.get(),
        "elapsedMs" to (if (started > 0) now - started else 0),
        "uptimeMs" to (if (started > 0) uptime - startedUptime else 0),
        "suspendEstimateMs" to (if (started > 0) maxOf(0L, (now - started) - (uptime - startedUptime)) else 0),
        "lastTickAgeMs" to (if (started > 0) now - last else 0),
        "maxGapMs" to maxOf(maxGap, if (running.get()) now - last else 0),
        "nativeTicks" to nativeTicks, "nativeLastTickAgeMs" to (if (started > 0) now - nativeLast else 0),
        "nativeMaxGapMs" to nativeMaxGap, "nativeWaitCalls" to waitCalls, "nativeWaitReturns" to waitReturns,
        "hostResumes" to hostResumes, "hostPauses" to hostPauses,
        "scheduler" to scheduler, "headless" to headless, "reason" to reason, "timeoutCount" to timeoutCount, "timeoutStopMs" to timeoutStopMs,
        "cleanupAttempted" to cleanupAttempted, "cleanupComplete" to cleanupComplete
      )
    }
    return state + mapOf(
      "reactLifecycle" to (reactContext?.lifecycleState?.name ?: "NONE"),
      "headlessTaskActive" to (reactContext?.let { HeadlessJsTaskContext.getInstance(it).hasActiveTasks() } ?: false),
      "interactive" to power.isInteractive, "deviceIdle" to power.isDeviceIdleMode, "powerSave" to power.isPowerSaveMode,
      "keyguardLocked" to ctx.getSystemService(KeyguardManager::class.java).isKeyguardLocked,
      "notificationPermission" to (ctx.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED),
      "channelImportance" to (manager.getNotificationChannel(channel)?.importance ?: -1), "notificationsEnabled" to manager.areNotificationsEnabled(),
      "activeNotifications" to notifications.size, "visibility" to (notifications.firstOrNull()?.notification?.visibility ?: -2),
      "genericText" to (notifications.firstOrNull()?.notification?.extras?.getCharSequence(Notification.EXTRA_TEXT)?.toString() == "X-Files is encrypting..."),
      "ongoing" to ((notifications.firstOrNull()?.notification?.flags ?: 0) and Notification.FLAG_ONGOING_EVENT != 0)
    )
  }
}

class P01bService : Service(), LifecycleEventListener {
  private var job = 0L
  private var heartbeatThread: HandlerThread? = null
  private var reactOwner: ReactContext? = null
  override fun onBind(intent: Intent?): IBinder? = null
  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    val g = intent?.getLongExtra("generation", -1) ?: -1
    if (P01bState.active(g)) return START_NOT_STICKY
    if (!P01bState.prepared(g)) {
      if (!P01bState.running.get()) stopSelf(startId)
      return START_NOT_STICKY
    }
    job = g
    try {
      val disabled = intent?.getBooleanExtra("disabled", false) ?: false
      val headless = intent?.getBooleanExtra("headless", true) ?: true
      val manager = getSystemService(NotificationManager::class.java)
      val channel = if (disabled) "p01b-disabled" else "p01b-jobs"
      if (Build.VERSION.SDK_INT >= 26) {
        val c = NotificationChannel(channel, "X-Files progress", if (disabled) NotificationManager.IMPORTANCE_NONE else NotificationManager.IMPORTANCE_LOW)
        c.lockscreenVisibility = Notification.VISIBILITY_SECRET; manager.createNotificationChannel(c)
      }
      val builder = if (Build.VERSION.SDK_INT >= 26) Notification.Builder(this, channel) else Notification.Builder(this)
      val n = builder.setSmallIcon(android.R.drawable.stat_sys_upload).setContentTitle("X-Files").setContentText("X-Files is encrypting...")
        .setVisibility(Notification.VISIBILITY_SECRET).setOngoing(true).setCategory(Notification.CATEGORY_SERVICE).setProgress(0, 0, true).build()
      if (Build.VERSION.SDK_INT >= 29) startForeground(1901, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC) else startForeground(1901, n)
      P01bState.begin(g, File(cacheDir, "p01b-spike"), headless, channel)
      reactOwner = P01bState.react?.get()
      reactOwner?.addLifecycleEventListener(this)
      val thread = HandlerThread("P01bDiagnostic", Process.THREAD_PRIORITY_BACKGROUND).also { it.start() }
      heartbeatThread = thread
      val handler = Handler(thread.looper)
      handler.post(object : Runnable {
        override fun run() {
          if (!P01bState.active(g)) return
          if (!P01bState.heartbeat(g)) {
            if (P01bState.cancel(g, "TEST_LIMIT")) stopSelf()
            return
          }
          handler.postDelayed(this, 1000)
        }
      })
      if (headless) {
        val react = reactOwner ?: throw IllegalStateException()
        val data = Arguments.createMap().apply { putDouble("generation", g.toDouble()); putString("scheduler", P01bState.scheduler) }
        HeadlessJsTaskContext.getInstance(react).startTask(HeadlessJsTaskConfig("P01bForeground", data, 0, true))
      }
      P01bState.markReady(g)
    } catch (_: Exception) {
      P01bState.cancel(g, "START_FAILED"); stopSelf(); P01bState.cleanup(g)
    }
    return START_NOT_STICKY
  }
  override fun onTimeout(startId: Int, fgsType: Int) {
    if (job != P01bState.generation) { stopSelf(startId); return }
    val start = SystemClock.elapsedRealtime()
    // Stop first. Cleanup takes a different lock and never holds up this deadline.
    stopForeground(STOP_FOREGROUND_REMOVE); stopSelf()
    P01bState.timeoutStopMs = SystemClock.elapsedRealtime() - start
    P01bState.timeoutCount++
    P01bState.cancel(job, "SERVICE_TIMEOUT"); P01bState.cleanup(job)
    Log.i("P01B_NATIVE", JSONObject(P01bState.snapshot(this)).toString())
  }
  override fun onDestroy() {
    P01bState.cancel(job, "STOPPED")
    reactOwner?.removeLifecycleEventListener(this); reactOwner = null
    heartbeatThread?.quitSafely(); heartbeatThread = null
    if (job == P01bState.generation) stopForeground(STOP_FOREGROUND_REMOVE)
    P01bState.cleanup(job)
    super.onDestroy()
  }
  override fun onHostResume() { P01bState.lifecycle(job, true) }
  override fun onHostPause() { P01bState.lifecycle(job, false) }
  override fun onHostDestroy() {
    if (P01bState.cancel(job, "CONTEXT_DESTROYED")) stopSelf()
  }
}

class P01bStatusReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    if (intent.action == "com.xfiles.P01B_STOP") {
      val generation = intent.getLongExtra("generation", P01bState.generation)
      val expectedProcess = intent.getLongExtra("processStartedElapsedMs", P01bState.processStartedElapsedMs)
      if (expectedProcess == P01bState.processStartedElapsedMs && P01bState.cancel(generation, "CANCELLED")) context.stopService(Intent(context, P01bService::class.java))
    }
    val state = P01bState.snapshot(context) + mapOf("requestId" to intent.getLongExtra("requestId", -1))
    Log.i("P01B_NATIVE", JSONObject(state).toString())
  }
}
