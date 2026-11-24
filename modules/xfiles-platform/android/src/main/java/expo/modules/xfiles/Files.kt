package expo.modules.xfiles

import android.content.ContentResolver
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.CancellationSignal
import android.os.SystemClock
import android.os.ParcelFileDescriptor
import android.os.Process
import android.os.StatFs
import android.os.Environment
import android.provider.DocumentsContract
import android.provider.OpenableColumns
import android.system.ErrnoException
import android.system.Os
import android.system.OsConstants
import expo.modules.kotlin.exception.CodedException
import java.io.File
import java.io.InputStream
import java.io.OutputStream
import java.io.RandomAccessFile
import java.util.concurrent.atomic.AtomicBoolean

internal const val CHUNK = 1024 * 1024
private const val MAX_SAFE_BYTES = 9007199254740991L
private const val EXTERNAL_STORAGE = "com.android.externalstorage.documents"
// DocumentsProvider's standard create/delete calls. The framework convenience
// wrappers log provider exceptions, which can include the document's name.
private const val DOCUMENT_URI = "uri"
private const val CREATE_DOCUMENT = "android:createDocument"
private const val DELETE_DOCUMENT = "android:deleteDocument"

internal class PlatformError(reason: String) : CodedException(reason, reason, null)

internal fun fail(reason: String): Nothing = throw PlatformError(reason)

internal inline fun <T> fileCall(fallback: String = "IO_ERROR", action: () -> T): T {
  try {
    return action()
  } catch (error: Exception) {
    if (error is PlatformError || error is kotlinx.coroutines.CancellationException) throw error
    if (generateSequence<Throwable>(error) { it.cause }.any {
        it is ErrnoException && it.errno == OsConstants.ENOSPC ||
          it.message?.contains("ENOSPC") == true
      }) fail("NO_SPACE")
    fail(fallback)
  }
}

internal fun grant(context: Context, uri: Uri, flags: Int) {
  if (uri.scheme != ContentResolver.SCHEME_CONTENT ||
      context.checkUriPermission(uri, Process.myPid(), Process.myUid(), flags) !=
        android.content.pm.PackageManager.PERMISSION_GRANTED) fail("UNSUPPORTED_PROVIDER")
}

internal fun parent(context: Context, raw: String): Uri = fileCall("UNSUPPORTED_PROVIDER") {
  val tree = Uri.parse(raw)
  if (!DocumentsContract.isTreeUri(tree)) fail("UNSUPPORTED_PROVIDER")
  grant(context, tree, Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION)
  DocumentsContract.buildDocumentUriUsingTree(tree, DocumentsContract.getTreeDocumentId(tree))
}

internal fun sourceSize(context: Context, uri: Uri, signal: CancellationSignal? = null): Long = fileCall("UNSUPPORTED_PROVIDER") {
  grant(context, uri, Intent.FLAG_GRANT_READ_URI_PERMISSION)
  val size = context.contentResolver.query(uri, arrayOf(OpenableColumns.SIZE), null, null, null, signal)?.use {
    if (it.moveToFirst() && !it.isNull(0)) it.getLong(0) else null
  } ?: fail("UNSUPPORTED_PROVIDER")
  if (size < 0) fail("UNSUPPORTED_PROVIDER")
  if (size > MAX_SAFE_BYTES) fail("RESOURCE_LIMIT")
  size
}

internal sealed class JobFile {
  private val cleanup = AtomicBoolean(false)
  fun scheduleCleanup() = cleanup.compareAndSet(false, true)
  abstract fun abort()
  abstract fun canCommit(): Boolean
}

internal class Source(
  private val stream: InputStream,
  private val stat: () -> Long
) : JobFile() {
  fun size() = stat()

  fun read(maximum: Int): ByteArray {
    if (maximum !in 1..CHUNK) fail("RESOURCE_LIMIT")
    val bytes = ByteArray(maximum)
    try {
      var count = stream.read(bytes)
      if (count == 0) {
        val first = stream.read()
        if (first >= 0) {
          bytes[0] = first.toByte()
          count = 1
        } else count = -1
      }
      if (count == maximum) return bytes
      return bytes.copyOf(maxOf(0, count)).also { bytes.fill(0) }
    } catch (error: Exception) {
      bytes.fill(0)
      throw error
    }
  }

  override fun abort() = stream.close()
  override fun canCommit() = false
}

internal class Output(
  val uri: Uri?,
  val temp: File?,
  private val delete: () -> Boolean
) : JobFile() {
  private var stream: OutputStream? = null
  private var descriptor: ParcelFileDescriptor? = null
  @Volatile private var closed = false
  private var deleted = false

  @Synchronized fun open(context: Context, job: FileJob) {
    if (job.ended.isCompleted || deleted) fail("CANCELLED")
    stream = if (temp != null) temp.outputStream() else {
      val pfd = context.contentResolver.openFileDescriptor(uri!!, "w", job.ioCancellation)
        ?: fail("UNSUPPORTED_PROVIDER")
      descriptor = pfd
      ParcelFileDescriptor.AutoCloseOutputStream(pfd)
    }
  }

  fun write(bytes: ByteArray) {
    if (bytes.size > CHUNK) fail("RESOURCE_LIMIT")
    // Normal writes are awaited. On stop the cleanup worker must be able to
    // close the descriptor even while a provider is blocking in write().
    val writer = synchronized(this) { stream ?: fail("IO_ERROR") }
    writer.write(bytes)
  }

  @Synchronized fun close() {
    if (closed) return
    val writer = stream ?: fail("IO_ERROR")
    stream = null
    try {
      writer.use {
        it.flush()
        descriptor?.checkError()
      }
      closed = true
    } finally {
      descriptor = null
    }
  }

  @Synchronized override fun abort() {
    if (deleted) return
    try {
      stream?.close()
    } catch (_: Exception) {
      // Always attempt deletion even if closing a failed writer throws.
    } finally {
      stream = null
      descriptor = null
    }
    if (!delete()) fail("IO_ERROR")
    deleted = true
  }

  override fun canCommit() = closed && temp == null
}

internal fun newDocument(context: Context, tree: String, name: String, mime: String): Output =
  fileCall("UNSUPPORTED_PROVIDER") {
    if (name.isEmpty() || name == "." || name == ".." ||
        name.any { it == '/' || it == '\\' || it == '\u0000' }) fail("IO_ERROR")
    val directory = parent(context, tree)
    val resolver = context.contentResolver
    val result = resolver.call(directory, CREATE_DOCUMENT, null, Bundle().apply {
      putParcelable(DOCUMENT_URI, directory)
      putString(DocumentsContract.Document.COLUMN_MIME_TYPE, mime)
      putString(DocumentsContract.Document.COLUMN_DISPLAY_NAME, name)
    }) ?: fail("UNSUPPORTED_PROVIDER")
    @Suppress("DEPRECATION")
    val uri = result.getParcelable<Uri>(DOCUMENT_URI) ?: fail("UNSUPPORTED_PROVIDER")
    // SAF createDocument allocates a new document and chooses the collision name.
    if (uri.authority != directory.authority || !DocumentsContract.isTreeUri(uri) ||
        DocumentsContract.getTreeDocumentId(uri) != DocumentsContract.getTreeDocumentId(directory) ||
        DocumentsContract.getDocumentId(uri) == DocumentsContract.getDocumentId(directory)) {
      fail("UNSUPPORTED_PROVIDER")
    }
    Output(uri, null) {
      // A provider may throw FileNotFoundException when it refuses deletion.
      // Treat every failed or missing acknowledgement as unconfirmed cleanup.
      resolver.call(uri, DELETE_DOCUMENT, null, Bundle().apply {
        putParcelable(DOCUMENT_URI, uri)
      }) != null
    }
  }

internal fun tempDirectory(context: Context) = File(context.cacheDir, "xfiles-tmp")

internal fun newTemp(context: Context): Output {
  val directory = tempDirectory(context)
  if (!directory.isDirectory && !directory.mkdirs()) fail("IO_ERROR")
  val file = File.createTempFile("bundle-", ".zip", directory)
  return Output(null, file) { wipeTemp(file) }
}

internal fun wipeTemp(file: File): Boolean {
  // Do not follow a symlink. Overwriting ordinary files is best effort on flash.
  try {
    if (OsConstants.S_ISREG(Os.lstat(file.path).st_mode)) {
      RandomAccessFile(file, "rw").use { writer ->
        val zeros = ByteArray(CHUNK)
        var remaining = writer.length()
        val deadline = SystemClock.elapsedRealtime() + 1000L
        while (remaining > 0 && SystemClock.elapsedRealtime() < deadline) {
          val count = minOf(remaining, zeros.size.toLong()).toInt()
          writer.write(zeros, 0, count)
          remaining -= count
        }
      }
    }
  } catch (_: Exception) {
    // Unlink even if overwrite could not finish.
  }
  return file.delete() || !file.exists()
}

internal fun volume(context: Context, tree: String?): Map<String, Any>? {
  return try {
    val cache = context.cacheDir
    val manager = context.getSystemService(android.os.storage.StorageManager::class.java)
    val root = if (tree == null) cache else {
      val uri = parent(context, tree)
      if (uri.authority != EXTERNAL_STORAGE) return null
      val id = DocumentsContract.getTreeDocumentId(uri).substringBefore(':')
      if (Build.VERSION.SDK_INT >= 30) {
        manager.storageVolumes.firstOrNull {
          (id == "primary" && it.isPrimary) || it.uuid.equals(id, ignoreCase = true)
        }?.directory ?: return null
      } else {
        if (id != "primary") return null
        @Suppress("DEPRECATION")
        Environment.getExternalStorageDirectory()
      }
    }
    val uuid = if (Build.VERSION.SDK_INT >= 26) {
      runCatching { manager.getUuidForPath(root) }.getOrNull()
    } else null
    // A shared emulated volume must map to its backing storage. If Android
    // cannot identify it, warn instead of treating its capacity as separate.
    if (uuid == null && tree != null && Environment.isExternalStorageEmulated(root)) return null
    val id = uuid?.let { "volume:$it" } ?: "device:${Os.stat(root.path).st_dev}"
    mapOf("id" to id, "available" to StatFs(root.path).availableBytes.coerceAtMost(MAX_SAFE_BYTES))
  } catch (_: Exception) {
    null
  }
}
