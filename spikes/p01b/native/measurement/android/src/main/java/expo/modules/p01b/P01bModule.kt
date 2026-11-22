package expo.modules.p01b

import android.Manifest
import android.app.NotificationManager
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Debug
import android.os.ParcelFileDescriptor
import android.provider.DocumentsContract
import android.provider.OpenableColumns
import com.facebook.react.bridge.ReactContext
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.functions.Coroutine
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.InputStream
import java.io.OutputStream
import java.io.File
import java.io.FileOutputStream
import java.lang.ref.WeakReference
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicInteger

// This entire module is development-only and absent from normal autolinking.
class P01bModule : Module() {
  private val readers = ConcurrentHashMap<Int, InputStream>()
  private data class Writer(val stream: OutputStream, val descriptor: ParcelFileDescriptor)
  private val writers = ConcurrentHashMap<Int, Writer>()
  private val ids = AtomicInteger(0)
  private fun context() = appContext.reactContext ?: throw CodedException("P01B_CONTEXT_UNAVAILABLE")
  private fun safeError(): Nothing = throw CodedException("P01B_IO_ERROR")
  override fun definition() = ModuleDefinition {
    Name("P01bMeasurement")
    Function("metrics") {
      val m = Debug.MemoryInfo(); Debug.getMemoryInfo(m)
      val status = File("/proc/self/status").readLines()
      fun number(prefix: String): Long = status.firstOrNull { it.startsWith(prefix) }?.substringAfter(':')?.trim()?.substringBefore(' ')?.toLongOrNull() ?: -1L
      mapOf("nativeAllocatedBytes" to Debug.getNativeHeapAllocatedSize(), "totalPssKiB" to m.totalPss, "rssKiB" to number("VmRSS:"), "rssHighWaterKiB" to number("VmHWM:"))
    }
    Function("serviceState") { P01bState.snapshot(context()) }
    Function("startService") { headless: Boolean, disabledChannel: Boolean ->
      val ctx = context()
      if (appContext.currentActivity == null) throw CodedException("P01B_FOREGROUND_REQUIRED")
      P01bState.react = WeakReference(ctx as ReactContext)
      val intent = Intent(ctx, P01bService::class.java).putExtra("headless", headless).putExtra("disabled", disabledChannel)
      if (Build.VERSION.SDK_INT >= 26) ctx.startForegroundService(intent) else ctx.startService(intent)
      true
    }
    Function("stopService") { context().stopService(Intent(context(), P01bService::class.java)) }
    Function("notificationPermission") { context().checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED }
    Function("deleteTestChannels") {
      val manager = context().getSystemService(NotificationManager::class.java)
      manager.deleteNotificationChannel("p01b-jobs"); manager.deleteNotificationChannel("p01b-disabled")
    }
    Function("cleanupTestFiles") {
      val files = File(context().cacheDir, "p01b-spike").listFiles() ?: emptyArray()
      val before = files.size; files.forEach { it.delete() }; mapOf("before" to before, "remaining" to (File(context().cacheDir, "p01b-spike").listFiles()?.size ?: 0))
    }
    AsyncFunction("openReader") Coroutine { raw: String -> withContext(Dispatchers.IO) {
      try {
        val uri = Uri.parse(raw); val resolver = context().contentResolver
        val size = resolver.query(uri, arrayOf(OpenableColumns.SIZE), null, null, null)?.use { c -> if (c.moveToFirst() && !c.isNull(0)) c.getLong(0) else -1L } ?: -1L
        if (size > 9007199254740991L || size < -1L) throw CodedException("P01B_RESOURCE_LIMIT")
        val stream = resolver.openInputStream(uri) ?: safeError()
        val id = ids.incrementAndGet(); readers[id] = stream
        mapOf("id" to id, "size" to size)
      } catch (_: Exception) { safeError() }
    } }
    AsyncFunction("read") Coroutine { id: Int, maximum: Int -> withContext(Dispatchers.IO) {
      if (maximum !in 1..1048576) safeError()
      try {
        val stream = readers[id] ?: safeError(); val buffer = ByteArray(maximum)
        var count = stream.read(buffer)
        while (count == 0) count = stream.read(buffer)
        if (count < 0) ByteArray(0) else buffer.copyOf(count)
      } catch (_: Exception) { safeError() }
    } }
    AsyncFunction("closeReader") Coroutine { id: Int -> withContext(Dispatchers.IO) { try { readers.remove(id)?.close() } catch (_: Exception) { safeError() } } }
    AsyncFunction("createOutput") Coroutine { parent: String, scenario: String -> withContext(Dispatchers.IO) {
      try {
        DocumentsContract.createDocument(context().contentResolver, Uri.parse(parent), "application/octet-stream", "p01b-$scenario-${System.nanoTime()}")?.toString() ?: safeError()
      } catch (_: Exception) { safeError() }
    } }
    AsyncFunction("openWriter") Coroutine { raw: String -> withContext(Dispatchers.IO) {
      try { val pfd = context().contentResolver.openFileDescriptor(Uri.parse(raw), "w") ?: safeError(); val stream = ParcelFileDescriptor.AutoCloseOutputStream(pfd); val id = ids.incrementAndGet(); writers[id] = Writer(stream, pfd); id }
      catch (_: Exception) { safeError() }
    } }
    AsyncFunction("write") Coroutine { id: Int, bytes: ByteArray -> withContext(Dispatchers.IO) {
      if (bytes.size > 1048576) safeError()
      try { (writers[id] ?: safeError()).stream.write(bytes) } catch (_: Exception) { safeError() }
    } }
    AsyncFunction("closeWriter") Coroutine { id: Int -> withContext(Dispatchers.IO) {
      val writer = writers.remove(id)
      if (writer != null) try { writer.stream.flush(); writer.descriptor.checkError() } catch (_: Exception) { safeError() } finally { try { writer.stream.close() } finally { writer.descriptor.close() } }
    } }
    AsyncFunction("deleteOutput") Coroutine { raw: String -> withContext(Dispatchers.IO) {
      try { DocumentsContract.deleteDocument(context().contentResolver, Uri.parse(raw)) } catch (_: Exception) { false }
    } }
    OnDestroy {
      readers.values.forEach { try { it.close() } catch (_: Exception) {} }; readers.clear()
      writers.values.forEach { try { it.stream.close() } catch (_: Exception) {} }; writers.clear()
    }
    Function("poke") { sequence: Int -> P01bState.poke(sequence) }
    AsyncFunction("workChunk") Coroutine { bytes: ByteArray -> withContext(Dispatchers.IO) {
      if (bytes.size > 1048576) safeError()
      if (!P01bState.running.get()) 0 else {
        val file = P01bState.owned
        if (file == null) 0 else try {
          FileOutputStream(file, true).use { it.write(bytes) }
          P01bState.workBytes.addAndGet(bytes.size.toLong()); bytes.size
        } catch (_: Exception) { safeError() }
      }
    } }
  }
}
