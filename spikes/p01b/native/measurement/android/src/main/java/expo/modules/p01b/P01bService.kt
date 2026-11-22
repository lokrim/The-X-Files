package expo.modules.p01b

import android.Manifest
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
import android.os.IBinder
import android.os.SystemClock
import android.util.Log
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.ReactContext
import com.facebook.react.jstasks.HeadlessJsTaskConfig
import com.facebook.react.jstasks.HeadlessJsTaskContext
import org.json.JSONObject
import java.io.File
import java.lang.ref.WeakReference
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicLong

object P01bState {
  var react: WeakReference<ReactContext>? = null
  val running = AtomicBoolean(false)
  val sequence = AtomicLong(0)
  val workBytes = AtomicLong(0)
  var started = 0L; var last = 0L; var maxGap = 0L; var timeoutCount = 0; var timeoutStopMs = 0L
  var reason = "NONE"; var headless = false; var channel = "p01b-jobs"
  @Volatile var cleanupAttempted = false
  @Volatile var cleanupComplete = false
  @Volatile var owned: File? = null
  @Synchronized fun poke(n: Int) {
    if (!running.get()) return
    val now = SystemClock.elapsedRealtime(); maxGap = maxOf(maxGap, now - last); last = now; sequence.set(n.toLong())
  }
  @Synchronized fun cleanup() {
    if (cleanupAttempted) return
    cleanupAttempted = true
    val file = owned; owned = null
    val generation = started
    Thread { val complete = file == null || file.delete() || !file.exists(); if (started == generation) cleanupComplete = complete }.start()
  }
  fun snapshot(ctx: Context): Map<String, Any> {
    val manager = ctx.getSystemService(NotificationManager::class.java)
    val notifications = manager.activeNotifications.filter { it.id == 1901 }
    return mapOf("running" to running.get(), "sequence" to sequence.get(), "workBytes" to workBytes.get(), "elapsedMs" to (SystemClock.elapsedRealtime() - started), "lastTickAgeMs" to (SystemClock.elapsedRealtime() - last), "maxGapMs" to maxGap, "headless" to headless, "reason" to reason, "timeoutCount" to timeoutCount, "timeoutStopMs" to timeoutStopMs, "cleanupAttempted" to cleanupAttempted, "cleanupComplete" to cleanupComplete, "notificationPermission" to (ctx.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED), "channelImportance" to (manager.getNotificationChannel(channel)?.importance ?: -1), "notificationsEnabled" to manager.areNotificationsEnabled(), "activeNotifications" to notifications.size, "visibility" to (notifications.firstOrNull()?.notification?.visibility ?: -2), "genericText" to (notifications.firstOrNull()?.notification?.extras?.getCharSequence(Notification.EXTRA_TEXT)?.toString() == "X-Files is encrypting..."), "ongoing" to ((notifications.firstOrNull()?.notification?.flags ?: 0) and Notification.FLAG_ONGOING_EVENT != 0))
  }
}
class P01bService : Service() {
  override fun onBind(intent: Intent?): IBinder? = null
  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    if (P01bState.running.get()) return START_NOT_STICKY
    val disabled = intent?.getBooleanExtra("disabled", false) ?: false
    val headless = intent?.getBooleanExtra("headless", true) ?: true
    val manager = getSystemService(NotificationManager::class.java)
    val channel = if (disabled) "p01b-disabled" else "p01b-jobs"
    if (Build.VERSION.SDK_INT >= 26) {
      val c = NotificationChannel(channel, "X-Files progress", if (disabled) NotificationManager.IMPORTANCE_NONE else NotificationManager.IMPORTANCE_LOW)
      c.lockscreenVisibility = Notification.VISIBILITY_SECRET; manager.createNotificationChannel(c)
    }
    val n = Notification.Builder(this, channel).setSmallIcon(android.R.drawable.stat_sys_upload).setContentTitle("X-Files").setContentText("X-Files is encrypting...").setVisibility(Notification.VISIBILITY_SECRET).setOngoing(true).setCategory(Notification.CATEGORY_SERVICE).setProgress(0, 0, true).build()
    if (Build.VERSION.SDK_INT >= 29) startForeground(1901, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC) else startForeground(1901, n)
    P01bState.started = SystemClock.elapsedRealtime(); P01bState.last = P01bState.started; P01bState.maxGap = 0
    P01bState.sequence.set(0); P01bState.workBytes.set(0); P01bState.headless = headless; P01bState.channel = channel; P01bState.reason = "RUNNING"
    P01bState.cleanupAttempted = false; P01bState.cleanupComplete = false
    val dir = File(cacheDir, "p01b-spike"); dir.mkdirs()
    P01bState.owned = File.createTempFile("job-", ".partial", dir).apply { outputStream().use { it.write(ByteArray(1048576)) } }
    P01bState.running.set(true)
    if (headless) {
      val react = P01bState.react?.get()
      if (react == null) { P01bState.reason = "CONTEXT_UNAVAILABLE"; stopSelf() }
      else HeadlessJsTaskContext.getInstance(react).startTask(HeadlessJsTaskConfig("P01bForeground", Arguments.createMap(), 0, true))
    }
    return START_NOT_STICKY
  }
  override fun onTimeout(startId: Int, fgsType: Int) {
    val start = SystemClock.elapsedRealtime()
    P01bState.reason = "SERVICE_TIMEOUT"; P01bState.timeoutCount++; P01bState.running.set(false)
    stopForeground(STOP_FOREGROUND_REMOVE); stopSelf()
    P01bState.timeoutStopMs = SystemClock.elapsedRealtime() - start
    P01bState.cleanup()
    Log.i("P01B_NATIVE", JSONObject(P01bState.snapshot(this)).toString())
  }
  override fun onDestroy() {
    P01bState.running.set(false)
    if (P01bState.reason == "RUNNING") P01bState.reason = "STOPPED"
    stopForeground(STOP_FOREGROUND_REMOVE); P01bState.cleanup(); super.onDestroy()
  }
}
class P01bStatusReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    if (intent.action == "com.xfiles.P01B_STOP") context.stopService(Intent(context, P01bService::class.java))
    Log.i("P01B_NATIVE", JSONObject(P01bState.snapshot(context)).toString())
  }
}
