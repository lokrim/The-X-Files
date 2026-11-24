package expo.modules.xfiles

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.os.SystemClock
import com.facebook.react.bridge.Arguments
import com.facebook.react.jstasks.HeadlessJsTaskConfig
import com.facebook.react.jstasks.HeadlessJsTaskContext

class FileJobService : Service() {
  private var job: FileJob? = null
  private var lastProgress = 0L
  private var ownerStartId = 0

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    val next = FileJobs.current
    if (next == null || next.id != intent?.getIntExtra(JOB_EXTRA, -1) || next.ended.isCompleted) {
      if (job?.ended?.isCompleted != false) stopSelf(startId)
      return START_NOT_STICKY
    }
    ownerStartId = startId
    if (job === next) return START_NOT_STICKY
    job = next
    lastProgress = 0L
    try {
      val manager = getSystemService(NotificationManager::class.java)
      if (Build.VERSION.SDK_INT >= 26) manager.createNotificationChannel(
        NotificationChannel(CHANNEL, "File operations", NotificationManager.IMPORTANCE_LOW).apply {
          lockscreenVisibility = Notification.VISIBILITY_SECRET
        }
      )
      if (Build.VERSION.SDK_INT >= 29) {
        startForeground(NOTIFICATION, notification(), ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
      } else {
        startForeground(NOTIFICATION, notification())
      }
      // Activate the existing app React context. The headless task only holds
      // that context while the already-running JS job awaits native I/O/yields.
      val data = Arguments.createMap().apply { putInt(JOB_EXTRA, next.id) }
      val react = next.react.get() ?: fail("IO_ERROR")
      HeadlessJsTaskContext.getInstance(react).startTask(HeadlessJsTaskConfig(HEADLESS_TASK, data, 0, true))
      instance = this
      next.ready.complete(true)
    } catch (_: Exception) {
      next.stop("IO_ERROR")
      removeAndStop()
    }
    return START_NOT_STICKY
  }

  @Suppress("DEPRECATION")
  private fun notification(progress: Int? = null) =
    (if (Build.VERSION.SDK_INT >= 26) Notification.Builder(this, CHANNEL) else Notification.Builder(this))
    .setSmallIcon(android.R.drawable.stat_sys_upload)
    .setContentTitle("X-Files")
    .setContentText("X-Files is processing files…")
    .setVisibility(Notification.VISIBILITY_SECRET)
    .setOngoing(true)
    .setOnlyAlertOnce(true)
    .setCategory(Notification.CATEGORY_SERVICE)
    .setProgress(100, progress ?: 0, progress == null)
    .build()

  private fun update(generation: Int, progress: Int) {
    val owner = job ?: return
    val now = SystemClock.elapsedRealtime()
    if (owner.id != generation || owner.ended.isCompleted || now - lastProgress < 100) return
    lastProgress = now
    getSystemService(NotificationManager::class.java).notify(NOTIFICATION, notification(progress))
  }

  override fun onTimeout(startId: Int, fgsType: Int) {
    if (ownerStartId != startId) return
    stopForeground(STOP_FOREGROUND_REMOVE)
    stopSelf(startId)
    job?.stop("SERVICE_TIMEOUT")
  }

  private fun removeAndStop() {
    stopForeground(STOP_FOREGROUND_REMOVE)
    stopSelf()
  }

  override fun onDestroy() {
    if (instance === this) instance = null
    job?.stop("CANCELLED")
    stopForeground(STOP_FOREGROUND_REMOVE)
    super.onDestroy()
  }

  companion object {
    private const val CHANNEL = "xfiles-file-jobs"
    private const val NOTIFICATION = 1901
    private var instance: FileJobService? = null

    fun progress(generation: Int, percent: Int) {
      instance?.update(generation, percent.coerceIn(0, 100))
    }
  }
}
