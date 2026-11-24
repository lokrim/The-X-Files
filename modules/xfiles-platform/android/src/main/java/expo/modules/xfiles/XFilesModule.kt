package expo.modules.xfiles

import android.app.Activity
import android.content.ClipData
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.provider.OpenableColumns
import android.view.WindowManager
import com.facebook.react.bridge.ReactContext
import com.facebook.react.common.LifecycleState
import expo.modules.kotlin.Promise
import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import kotlinx.coroutines.yield

class XFilesModule : Module() {
  private var picker: Promise? = null
  private var ownedJob: FileJob? = null
  private var screenSecure = true
  private val clipboard = SecretClipboard { appContext.currentActivity }

  private fun react() = appContext.reactContext as? ReactContext ?: fail("IO_ERROR")

  private fun foreground(): Activity {
    if (react().lifecycleState != LifecycleState.RESUMED) fail("IO_ERROR")
    return appContext.currentActivity ?: fail("IO_ERROR")
  }

  private suspend fun <T> io(
    generation: Int,
    fallback: String = "IO_ERROR",
    action: (FileJob) -> T
  ): T = withContext(Dispatchers.IO) {
    val job = FileJobs.require(generation)
    job.enter()
    try {
      fileCall(fallback) { action(job) }
    } finally {
      job.leave()
      job.checkCleaned()
    }
  }

  private fun applyScreenGuard(activity: Activity) {
    if (screenSecure) activity.window.addFlags(WindowManager.LayoutParams.FLAG_SECURE)
    else activity.window.clearFlags(WindowManager.LayoutParams.FLAG_SECURE)
  }

  override fun definition() = ModuleDefinition {
    Name("XFilesPlatform")

    OnActivityEntersForeground {
      // Expo can replay this event during module initialization on the JS thread.
      appContext.currentActivity?.let { activity ->
        activity.runOnUiThread {
          if (appContext.currentActivity === activity) applyScreenGuard(activity)
        }
      }
    }
    AsyncFunction("setScreenSecure") { enabled: Boolean ->
      val activity = appContext.currentActivity ?: fail("IO_ERROR")
      val focused = react().lifecycleState == LifecycleState.RESUMED && activity.hasWindowFocus()
      if (enabled || focused) {
        screenSecure = enabled
        applyScreenGuard(activity)
      }
      focused
    }.runOnQueue(Queues.MAIN)
    AsyncFunction("copySecret") { text: String, seconds: Int ->
      foreground()
      fileCall { clipboard.copy(text, seconds) }
    }.runOnQueue(Queues.MAIN)
    AsyncFunction("expireClipboard") {
      fileCall { clipboard.expire() }
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("chooseDirectory") { promise: Promise ->
      if (picker != null) fail("IO_ERROR")
      val activity = foreground()
      try {
        val intent = Intent(Intent.ACTION_OPEN_DOCUMENT_TREE).addFlags(
          Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION
        )
        activity.startActivityForResult(intent, DIRECTORY_REQUEST)
        picker = promise
      } catch (_: Exception) {
        promise.reject("UNSUPPORTED_PROVIDER", "UNSUPPORTED_PROVIDER", null)
      }
    }.runOnQueue(Queues.MAIN)

    OnActivityResult { _, result ->
      if (result.requestCode == DIRECTORY_REQUEST) {
        val promise = picker
        picker = null
        val uri = result.data?.data
        if (result.resultCode == Activity.RESULT_OK && uri != null) {
          try {
            parent(react(), uri.toString())
            promise?.resolve(uri.toString())
          } catch (_: Exception) {
            promise?.reject("UNSUPPORTED_PROVIDER", "UNSUPPORTED_PROVIDER", null)
          }
        } else promise?.resolve(null)
      }
    }

    AsyncFunction("directoryLabel") Coroutine { tree: String ->
      withContext(Dispatchers.IO) {
        val context = react()
        val uri = parent(context, tree)
        runCatching {
          context.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use {
            if (it.moveToFirst() && !it.isNull(0)) it.getString(0) else null
          }
        }.getOrNull() ?: "Selected folder"
      }
    }

    AsyncFunction("shareDocument") { raw: String, mime: String ->
      fileCall("UNSUPPORTED_PROVIDER") {
        val activity = foreground()
        val uri = Uri.parse(raw)
        grant(activity, uri, Intent.FLAG_GRANT_READ_URI_PERMISSION)
        val send = Intent(Intent.ACTION_SEND).setType(mime)
          .putExtra(Intent.EXTRA_STREAM, uri)
          .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        send.clipData = ClipData.newRawUri(null, uri)
        activity.startActivity(Intent.createChooser(send, null))
      }
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("start") {
      foreground()
      val context = react()
      val job = FileJobs.prepare(context).also { ownedJob = it }
      val intent = Intent(context, FileJobService::class.java).putExtra(JOB_EXTRA, job.id)
      try {
        if (Build.VERSION.SDK_INT >= 26) context.startForegroundService(intent) else context.startService(intent)
        job.id
      } catch (_: Exception) {
        job.stop("IO_ERROR")
        fail("IO_ERROR")
      }
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("awaitReady") Coroutine { generation: Int ->
      val job = FileJobs.require(generation)
      withTimeoutOrNull(5000) { job.ready.await() } == true
    }
    AsyncFunction("awaitEnd") Coroutine { generation: Int -> FileJobs.require(generation).ended.await() }
    AsyncFunction("awaitCleanup") Coroutine { generation: Int ->
      val job = FileJobs.require(generation)
      withTimeoutOrNull(2000) { job.cleaned.await() } == true
    }
    AsyncFunction("yieldRecord") Coroutine { generation: Int, delayMs: Int ->
      val job = FileJobs.require(generation)
      withContext(Dispatchers.Default) {
        if (delayMs == 0) yield()
        else withTimeoutOrNull(delayMs.coerceIn(1, 2000).toLong()) { job.ended.await() }
        !job.ended.isCompleted
      }
    }
    AsyncFunction("progress") { generation: Int, percent: Int ->
      FileJobService.progress(generation, percent)
    }.runOnQueue(Queues.MAIN)
    AsyncFunction("finish") { generation: Int, commit: Boolean ->
      val job = FileJobs.require(generation)
      val saved = commit && job.commit()
      if (!saved) job.stop(if (commit) "IO_ERROR" else "CANCELLED")
      FileJobs.stopService(react(), job)
      saved
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("sourceSize") Coroutine { raw: String ->
      withContext(Dispatchers.IO) { sourceSize(react(), Uri.parse(raw)) }
    }
    AsyncFunction("inspectHeader") Coroutine { raw: String ->
      withContext(Dispatchers.IO) {
        fileCall("UNSUPPORTED_PROVIDER") {
          val context = react()
          val uri = Uri.parse(raw)
          grant(context, uri, Intent.FLAG_GRANT_READ_URI_PERMISSION)
          val stream = context.contentResolver.openInputStream(uri) ?: fail("UNSUPPORTED_PROVIDER")
          stream.use {
            val header = ByteArray(48)
            var count = 0
            while (count < header.size) {
              val read = it.read(header, count, header.size - count)
              if (read < 0) break
              if (read == 0) {
                val byte = it.read()
                if (byte < 0) break
                header[count++] = byte.toByte()
              } else count += read
            }
            header.copyOf(count)
          }
        }
      }
    }
    AsyncFunction("openSource") Coroutine { generation: Int, raw: String ->
      io(generation, "UNSUPPORTED_PROVIDER") { job ->
        val context = react()
        val uri = Uri.parse(raw)
        grant(context, uri, Intent.FLAG_GRANT_READ_URI_PERMISSION)
        val afd = context.contentResolver.openAssetFileDescriptor(uri, "r", job.ioCancellation)
          ?: fail("UNSUPPORTED_PROVIDER")
        val stream = try { afd.createInputStream() } catch (error: Exception) {
          afd.close()
          throw error
        }
        job.own(Source(stream) { sourceSize(context, uri, job.ioCancellation) })
      }
    }
    AsyncFunction("openTemp") Coroutine { generation: Int, writer: Int ->
      io(generation) { job ->
        val temp = (job.files[writer] as? Output)?.temp ?: fail("IO_ERROR")
        job.own(Source(temp.inputStream()) { if (temp.isFile) temp.length() else fail("SOURCE_CHANGED") })
      }
    }
    AsyncFunction("readerSize") Coroutine { generation: Int, reader: Int ->
      io(generation) { job -> (job.files[reader] as? Source ?: fail("IO_ERROR")).size() }
    }
    AsyncFunction("read") Coroutine { generation: Int, reader: Int, maximum: Int ->
      io(generation) { job -> (job.files[reader] as? Source ?: fail("IO_ERROR")).read(maximum) }
    }
    AsyncFunction("closeReader") Coroutine { generation: Int, reader: Int ->
      io(generation) { job ->
        val file = job.files[reader] as? Source
        if (file != null) {
          file.abort()
          job.files.remove(reader, file)
        }
      }
    }

    AsyncFunction("createOutput") Coroutine { generation: Int, tree: String?, name: String, mime: String ->
      io(generation) { job ->
        val context = react()
        val output = if (tree == null) newTemp(context) else newDocument(context, tree, name, mime)
        val id = job.own(output)
        output.open(context, job)
        mapOf("id" to id, "uri" to output.uri?.toString())
      }
    }
    AsyncFunction("write") Coroutine { generation: Int, writer: Int, bytes: ByteArray ->
      try {
        io(generation) { job -> (job.files[writer] as? Output ?: fail("IO_ERROR")).write(bytes) }
      } finally {
        bytes.fill(0)
      }
    }
    AsyncFunction("closeWriter") Coroutine { generation: Int, writer: Int ->
      io(generation) { job -> (job.files[writer] as? Output ?: fail("IO_ERROR")).close() }
    }
    AsyncFunction("abortOutput") Coroutine { generation: Int, writer: Int ->
      io(generation) { job ->
        val output = job.files[writer] as? Output
        if (output != null) {
          output.abort()
          job.files.remove(writer, output)
        }
      }
    }

    AsyncFunction("volume") Coroutine { tree: String? -> withContext(Dispatchers.IO) { volume(react(), tree) } }
    AsyncFunction("sweepTemp").Coroutine<Boolean> {
      withContext(Dispatchers.IO) {
        if (FileJobs.current?.ended?.isCompleted == false) fail("IO_ERROR")
        val directory = tempDirectory(react())
        val files = directory.listFiles()
        if (files == null) !directory.exists()
        else files.map(::wipeTemp).all { it }
      }
    }

    OnDestroy {
      Handler(Looper.getMainLooper()).post {
        clipboard.forget()
        picker?.reject("CANCELLED", "CANCELLED", null)
        picker = null
        ownedJob?.let {
          if (it.stop("CANCELLED")) FileJobs.stopService(it.context, it)
        }
      }
    }
  }

  companion object {
    private const val DIRECTORY_REQUEST = 5405
  }
}
