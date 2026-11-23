package com.xfiles.p01bprovider;
import android.content.*;
import android.net.Uri;
import android.provider.DocumentsContract;
import android.util.Log;
import org.json.JSONObject;
public class ControlReceiver extends BroadcastReceiver {
  @Override public void onReceive(Context context, Intent intent) {
    String action = intent.getAction();
    if (action.endsWith("GRANT")) {
      for (String id : new String[]{"short","large","denied","unsafe"}) context.grantUriPermission("com.xfiles.app", DocumentsContract.buildDocumentUri(SyntheticProvider.AUTH, id), Intent.FLAG_GRANT_READ_URI_PERMISSION);
      context.grantUriPermission("com.xfiles.app", DocumentsContract.buildTreeDocumentUri(SyntheticProvider.AUTH, "root"), Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION | Intent.FLAG_GRANT_PREFIX_URI_PERMISSION);
    } else if (action.endsWith("REVOKE")) context.revokeUriPermission(DocumentsContract.buildDocumentUri(SyntheticProvider.AUTH,"short"), Intent.FLAG_GRANT_READ_URI_PERMISSION);
    else if (action.endsWith("RESET")) SyntheticProvider.reset();
    JSONObject result = new JSONObject();
    try {
      result.put("documents", SyntheticProvider.outputs.size()); result.put("action", action.substring(action.lastIndexOf('.') + 1));
      int uid = context.getPackageManager().getApplicationInfo("com.xfiles.app",0).uid;
      result.put("targetVisible",true);
      result.put("shortReadGranted",context.checkUriPermission(DocumentsContract.buildDocumentUri(SyntheticProvider.AUTH,"short"),-1,uid,Intent.FLAG_GRANT_READ_URI_PERMISSION)==android.content.pm.PackageManager.PERMISSION_GRANTED);
    } catch (Exception ignored) { try { result.put("targetVisible",false); } catch (Exception unused) {} }
    Log.i("P01B_PROVIDER", result.toString());
  }
}
