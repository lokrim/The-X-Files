package expo.modules.xfiles

import android.content.Context
import android.content.Intent
import android.os.CancellationSignal
import com.facebook.react.bridge.ReactContext
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import java.lang.ref.WeakReference
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicInteger

internal const val JOB_EXTRA = "generation"
internal const val HEADLESS_TASK = "XFilesFileJob"

internal class FileJob(val id: Int, reactContext: ReactContext) {
  val context: Context = reactContext.applicationContext
  val react = WeakReference(reactContext)
  val ready = CompletableDeferred<Boolean>()
  val ended = CompletableDeferred<String>()
  val cleaned = CompletableDeferred<Boolean>()
  val ioCancellation = CancellationSignal()
  val files = ConcurrentHashMap<Int, JobFile>()
  private val ids = AtomicInteger()
  private var inFlight = 0

  @Synchronized fun enter() {
    if (ended.isCompleted) fail("CANCELLED")
    inFlight++
  }

  @Synchronized fun leave() { inFlight-- }

  // Register a creation even if cancellation happened during the provider call.
  @Synchronized fun own(file: JobFile): Int {
    val handle = ids.incrementAndGet()
    files[handle] = file
    if (ended.isCompleted) FileJobs.scheduleCleanup(this, handle, file)
    return handle
  }

  @Synchronized fun stop(reason: String): Boolean {
    if (!ended.complete(reason)) return false
    ready.complete(false)
    FileJobs.cancelIo(this)
    // Clean each handle independently so an unresponsive provider cannot
    // prevent cleanup of already closed files on another provider.
    FileJobs.scheduleCleanup(this)
    checkCleaned()
    return true
  }

  @Synchronized fun commit(): Boolean {
    if (ended.isCompleted || inFlight != 0 || files.values.any { !it.canCommit() }) return false
    ended.complete("COMPLETED")
    files.clear()
    cleaned.complete(true)
    return true
  }

  @Synchronized fun checkCleaned() {
    if (ended.isCompleted && inFlight == 0 && files.isEmpty()) cleaned.complete(true)
  }
}

internal object FileJobs {
  private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
  private val cleanupScope = CoroutineScope(SupervisorJob() + Dispatchers.IO.limitedParallelism(4))
  private var generation = 0
  @Volatile var current: FileJob? = null
    private set

  @Synchronized fun prepare(react: ReactContext): FileJob {
    if (current?.ended?.isCompleted == false) fail("IO_ERROR")
    return FileJob(++generation, react).also { current = it }
  }

  fun require(id: Int): FileJob = current?.takeIf { it.id == id } ?: fail("CANCELLED")

  fun stopService(context: Context, job: FileJob) {
    if (current === job) context.stopService(Intent(context, FileJobService::class.java))
  }

  fun cancelIo(job: FileJob) {
    scope.launch { runCatching { job.ioCancellation.cancel() } }
  }

  fun scheduleCleanup(job: FileJob) {
    scope.launch {
      job.files.forEach { (handle, file) -> scheduleCleanup(job, handle, file) }
    }
  }

  fun scheduleCleanup(job: FileJob, handle: Int, file: JobFile) {
    if (!file.scheduleCleanup()) return
    cleanupScope.launch {
      runCatching { file.abort() }
        .onSuccess { job.files.remove(handle, file) }
      job.checkCleaned()
    }
  }
}
