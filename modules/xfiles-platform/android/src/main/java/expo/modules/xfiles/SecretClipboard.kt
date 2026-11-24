package expo.modules.xfiles

import android.app.Activity
import android.content.ClipData
import android.content.ClipboardManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.PersistableBundle
import android.os.SystemClock
import java.security.MessageDigest
import java.util.UUID

/** Main thread only. Never keeps a second plaintext string for the timer. */
internal class SecretClipboard(private val activity: () -> Activity?) {
  private val handler = Handler(Looper.getMainLooper())
  private val timer = Runnable { runCatching { expire() } }
  private var hash: ByteArray? = null
  private var expiresAt = 0L

  fun copy(text: String, seconds: Int) {
    if (seconds != 0 && seconds != 30 && seconds != 60) fail("IO_ERROR")
    val owner = activity() ?: fail("IO_ERROR")
    val manager = owner.getSystemService(ClipboardManager::class.java)
    val clip = ClipData.newPlainText("X-Files", text)
    val marker = UUID.randomUUID().toString()
    clip.description.extras = PersistableBundle().apply {
      putBoolean("android.content.extra.IS_SENSITIVE", true)
      putString(OWNER_MARKER, marker)
    }
    manager.setPrimaryClip(clip)
    forget()
    if (seconds != 0) {
      hash = fingerprint(text, marker)
      expiresAt = SystemClock.elapsedRealtime() + seconds * 1000L
      handler.postDelayed(timer, seconds * 1000L)
    }
  }

  fun expire() {
    val expected = hash ?: return
    if (SystemClock.elapsedRealtime() < expiresAt) return
    val owner = activity()?.takeIf { it.hasWindowFocus() } ?: return
    val manager = owner.getSystemService(ClipboardManager::class.java)
    val clip = manager.primaryClip
    val text = if (clip?.itemCount == 1) clip.getItemAt(0).text else null
    val marker = clip?.description?.extras?.getString(OWNER_MARKER)
    try {
      if (text != null && marker != null) {
        val actual = fingerprint(text, marker)
        try {
          val current = manager.primaryClipDescription
          if (MessageDigest.isEqual(actual, expected) && current?.extras?.getString(OWNER_MARKER) == marker &&
            (Build.VERSION.SDK_INT < 26 || current.timestamp == clip.description.timestamp)) {
            if (Build.VERSION.SDK_INT >= 28) manager.clearPrimaryClip()
            else manager.setPrimaryClip(ClipData.newPlainText("", ""))
          }
        } finally {
          actual.fill(0)
        }
      }
      forget()
    } catch (_: SecurityException) {
      // Android can revoke clipboard access during a focus change. Retry on focus.
    }
  }

  fun forget() {
    handler.removeCallbacks(timer)
    hash?.fill(0)
    hash = null
    expiresAt = 0
  }

  private companion object {
    const val OWNER_MARKER = "com.xfiles.app.CLIPBOARD_OWNER"
  }

  private fun fingerprint(text: CharSequence, marker: String): ByteArray {
    val bytes = text.toString().toByteArray(Charsets.UTF_8)
    try {
      return MessageDigest.getInstance("SHA-256").apply {
        update(marker.toByteArray(Charsets.US_ASCII))
        update(0.toByte())
      }.digest(bytes)
    } finally {
      bytes.fill(0)
    }
  }
}
