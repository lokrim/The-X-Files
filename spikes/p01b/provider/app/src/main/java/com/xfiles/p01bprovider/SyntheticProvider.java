package com.xfiles.p01bprovider;

import android.database.Cursor;
import android.database.MatrixCursor;
import android.os.CancellationSignal;
import android.os.ParcelFileDescriptor;
import android.provider.DocumentsContract;
import android.provider.DocumentsProvider;
import java.io.*;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicInteger;

/** Separate-UID, offline, synthetic-only fault provider. Never part of X-Files. */
public class SyntheticProvider extends DocumentsProvider {
  public static final String AUTH = "com.xfiles.p01bprovider";
  static final ConcurrentHashMap<String, File> outputs = new ConcurrentHashMap<>();
  static final AtomicInteger ids = new AtomicInteger();
  static File base;
  @Override public boolean onCreate() { base = new File(getContext().getCacheDir(), "p01b-provider"); base.mkdirs(); return true; }
  private static final String[] DOC = {DocumentsContract.Document.COLUMN_DOCUMENT_ID, DocumentsContract.Document.COLUMN_DISPLAY_NAME, DocumentsContract.Document.COLUMN_MIME_TYPE, DocumentsContract.Document.COLUMN_FLAGS, DocumentsContract.Document.COLUMN_SIZE};
  private void document(MatrixCursor c, String id) {
    MatrixCursor.RowBuilder row = c.newRow();
    for (String key : c.getColumnNames()) {
      if (key.equals(DocumentsContract.Document.COLUMN_DOCUMENT_ID)) row.add(id);
      else if (key.equals(DocumentsContract.Document.COLUMN_DISPLAY_NAME)) row.add("P01b " + id);
      else if (key.equals(DocumentsContract.Document.COLUMN_MIME_TYPE)) row.add(id.equals("root") ? DocumentsContract.Document.MIME_TYPE_DIR : "application/octet-stream");
      else if (key.equals(DocumentsContract.Document.COLUMN_FLAGS)) row.add(id.equals("root") ? DocumentsContract.Document.FLAG_DIR_SUPPORTS_CREATE : DocumentsContract.Document.FLAG_SUPPORTS_DELETE | DocumentsContract.Document.FLAG_SUPPORTS_WRITE);
      else if (key.equals(DocumentsContract.Document.COLUMN_SIZE)) row.add(id.equals("large") ? 2000000003L : id.equals("unsafe") ? Long.MAX_VALUE : outputs.containsKey(id) ? outputs.get(id).length() : 65553L);
      else row.add(null);
    }
  }
  @Override public Cursor queryRoots(String[] projection) {
    String[] cols = projection == null ? new String[]{DocumentsContract.Root.COLUMN_ROOT_ID, DocumentsContract.Root.COLUMN_DOCUMENT_ID, DocumentsContract.Root.COLUMN_TITLE, DocumentsContract.Root.COLUMN_FLAGS, DocumentsContract.Root.COLUMN_MIME_TYPES, DocumentsContract.Root.COLUMN_AVAILABLE_BYTES} : projection;
    MatrixCursor c = new MatrixCursor(cols); MatrixCursor.RowBuilder row = c.newRow();
    for (String key : cols) {
      if (key.equals(DocumentsContract.Root.COLUMN_ROOT_ID) || key.equals(DocumentsContract.Root.COLUMN_DOCUMENT_ID)) row.add("root");
      else if (key.equals(DocumentsContract.Root.COLUMN_TITLE)) row.add("P01b synthetic provider");
      else if (key.equals(DocumentsContract.Root.COLUMN_FLAGS)) row.add(DocumentsContract.Root.FLAG_SUPPORTS_CREATE | DocumentsContract.Root.FLAG_LOCAL_ONLY);
      else if (key.equals(DocumentsContract.Root.COLUMN_MIME_TYPES)) row.add("*/*");
      else if (key.equals(DocumentsContract.Root.COLUMN_AVAILABLE_BYTES)) row.add(base.getUsableSpace());
      else row.add(null);
    } return c;
  }
  @Override public Cursor queryDocument(String id, String[] projection) throws FileNotFoundException {
    if (id.contains("-") && !outputs.containsKey(id)) throw new FileNotFoundException("P01B_MISSING");
    MatrixCursor c = new MatrixCursor(projection == null ? DOC : projection); document(c, id); return c;
  }
  @Override public Cursor queryChildDocuments(String id, String[] projection, String sortOrder) {
    MatrixCursor c = new MatrixCursor(projection == null ? DOC : projection);
    for (String name : new String[]{"short", "large", "denied", "unsafe"}) document(c, name);
    for (String name : outputs.keySet()) document(c, name); return c;
  }
  @Override public boolean isChildDocument(String parent, String child) { return parent.equals("root"); }
  @Override public String createDocument(String parent, String mime, String name) throws FileNotFoundException {
    if (!parent.equals("root")) throw new FileNotFoundException("P01B_DENIED");
    String scenario = name.contains("deleteDenied") ? "deleteDenied" : name.contains("closeFault") ? "closeFault" : name.contains("full") ? "full" : name.contains("denied") ? "denied" : "normal";
    String id = scenario + "-" + ids.incrementAndGet();
    File file = new File(base, id);
    try { if (!file.createNewFile()) throw new IOException(); } catch (IOException e) { throw new FileNotFoundException("P01B_CREATE_FAILED"); }
    outputs.put(id, file); return id;
  }
  @Override public void deleteDocument(String id) throws FileNotFoundException {
    if (id.startsWith("deleteDenied")) throw new FileNotFoundException("P01B_DELETE_DENIED");
    File file = outputs.remove(id);
    if (file == null || (!file.delete() && file.exists())) throw new FileNotFoundException("P01B_DELETE_FAILED");
  }
  @Override public ParcelFileDescriptor openDocument(String id, String mode, CancellationSignal signal) throws FileNotFoundException {
    if (id.equals("denied") || id.startsWith("denied-")) throw new FileNotFoundException("P01B_PROVIDER_DENIED");
    if (id.startsWith("full-")) throw new FileNotFoundException("P01B_NO_SPACE");
    try {
      if (id.equals("short")) {
        if (!mode.equals("r")) throw new FileNotFoundException("P01B_MODE_DENIED");
        ParcelFileDescriptor[] pipe = ParcelFileDescriptor.createPipe();
        new Thread(() -> {
          try (OutputStream out = new ParcelFileDescriptor.AutoCloseOutputStream(pipe[1])) {
            byte[] b = new byte[257]; long left = 65553;
            while (left > 0) { int n = (int)Math.min(left, b.length); out.write(b, 0, n); left -= n; Thread.sleep(1); }
          } catch (Exception ignored) { /* Reader cancel deliberately closes pipe. */ }
        }).start(); return pipe[0];
      }
      if (id.startsWith("closeFault-")) {
        ParcelFileDescriptor[] pipe = ParcelFileDescriptor.createReliablePipe();
        new Thread(() -> {
          try { new ParcelFileDescriptor.AutoCloseInputStream(pipe[0]).read(); Thread.sleep(100); pipe[0].closeWithError("P01B_CLOSE_ERROR"); }
          catch (Exception ignored) { /* Synthetic remote-close fault only. */ }
        }).start(); return pipe[1];
      }
      File file;
      if (id.equals("large")) {
        file = new File(base, "large");
        synchronized (SyntheticProvider.class) {
          if (!file.exists()) {
            try (OutputStream out = new FileOutputStream(file)) {
              byte[] b = new byte[65536]; long left = 2000000003L;
              while (left > 0) { int n = (int)Math.min(left, b.length); out.write(b, 0, n); left -= n; }
            }
          }
        }
        if (!mode.equals("r")) throw new FileNotFoundException("P01B_SOURCE_READ_ONLY");
      } else { file = outputs.get(id); if (file == null) throw new FileNotFoundException("P01B_MISSING"); }
      return ParcelFileDescriptor.open(file, mode.equals("r") ? ParcelFileDescriptor.MODE_READ_ONLY : ParcelFileDescriptor.MODE_WRITE_ONLY | ParcelFileDescriptor.MODE_TRUNCATE);
    } catch (IOException e) { throw new FileNotFoundException("P01B_PROVIDER_IO"); }
  }
  static void reset() {
    for (File f : outputs.values()) f.delete(); outputs.clear();
  }
}
