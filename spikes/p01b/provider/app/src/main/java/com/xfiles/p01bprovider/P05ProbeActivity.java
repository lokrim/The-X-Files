package com.xfiles.p01bprovider;

import android.app.Activity;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.util.Log;
import android.widget.TextView;
import java.io.InputStream;

/** Isolated local recipient and clipboard owner for synthetic P05 fixtures. */
public class P05ProbeActivity extends Activity {
  private static final String COPY = "com.xfiles.p01bprovider.P05_COPY";
  private static final String TAG = "XFILES_P05_PROBE";
  private boolean copied;
  private TextView result;

  @Override public void onCreate(Bundle state) {
    super.onCreate(state);
    result = new TextView(this);
    result.setText("P05 synthetic test recipient");
    setContentView(result);
    if (Intent.ACTION_SEND.equals(getIntent().getAction())) {
      new Thread(this::readShare).start();
    }
  }

  @Override public void onWindowFocusChanged(boolean hasFocus) {
    super.onWindowFocusChanged(hasFocus);
    if (!hasFocus || copied || !COPY.equals(getIntent().getAction())) return;
    copied = true;
    String text = getIntent().getBooleanExtra("same", false)
      ? "P05 public clipboard fixture"
      : "P05 clipboard replacement";
    getSystemService(ClipboardManager.class).setPrimaryClip(ClipData.newPlainText("P05 synthetic test", text));
    report("CLIPBOARD_REPLACED", 0);
  }

  @SuppressWarnings("deprecation")
  private void readShare() {
    Uri uri = getIntent().getParcelableExtra(Intent.EXTRA_STREAM);
    if (uri == null && "text/plain".equals(getIntent().getType())) {
      report("P05 public clipboard fixture".equals(getIntent().getStringExtra(Intent.EXTRA_TEXT))
        ? "SHARE_TEXT_PASS" : "SHARE_TEST_TEXT_REQUIRED", 0);
      return;
    }
    if (uri == null || !"content".equals(uri.getScheme()) ||
        !uri.toString().contains("XFiles-P05-")) {
      report("SHARE_TEST_URI_REQUIRED", 0);
      return;
    }
    long total = 0;
    byte[] chunk = new byte[16384];
    try (InputStream input = getContentResolver().openInputStream(uri)) {
      if (input == null) {
        report("SHARE_READ_FAILED", 0);
        return;
      }
      for (int count; (count = input.read(chunk)) != -1;) {
        total += count;
        if (total > 64 * 1024 * 1024) {
          report("SHARE_TEST_SIZE_LIMIT", 0);
          return;
        }
      }
      report("SHARE_READ_PASS", total);
    } catch (Exception ignored) {
      report("SHARE_READ_FAILED", 0);
    }
  }

  private void report(String reason, long bytes) {
    Log.i(TAG, "{\"reason\":\"" + reason + "\",\"bytes\":" + bytes + "}");
    runOnUiThread(() -> result.setText(reason));
  }
}
