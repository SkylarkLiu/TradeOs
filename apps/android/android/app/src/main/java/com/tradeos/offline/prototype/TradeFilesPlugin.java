package com.tradeos.offline.prototype;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.UUID;

@CapacitorPlugin(name = "TradeFiles")
public class TradeFilesPlugin extends Plugin {
    private static final int LIMIT = 10_000_000;
    private String content(PluginCall call) throws IOException {
        String data = call.getString("content");
        if (data == null || data.getBytes(StandardCharsets.UTF_8).length > LIMIT) throw new IOException("备份最多10MB");
        return data;
    }
    private String read(InputStream stream) throws IOException {
        if (stream == null) throw new IOException("无法读取文件");
        try (InputStream input = stream; ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[8192]; int n;
            while ((n = input.read(buffer)) != -1) {
                if (output.size() + n > LIMIT) throw new IOException("备份最多10MB");
                output.write(buffer, 0, n);
            }
            return new String(output.toByteArray(), StandardCharsets.UTF_8);
        }
    }
    @PluginMethod public void exportJson(PluginCall call) {
        try { content(call); } catch (IOException e) { call.reject(e.getMessage()); return; }
        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("application/json");
        intent.putExtra(Intent.EXTRA_TITLE, call.getString("name", "tradeos-offline-prototype.json"));
        startActivityForResult(call, intent, "exportResult");
    }
    @ActivityCallback private void exportResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        JSObject response = new JSObject();
        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null) { response.put("cancelled", true); call.resolve(response); return; }
        Uri uri = result.getData().getData();
        try (OutputStream stream = getContext().getContentResolver().openOutputStream(uri, "wt")) {
            if (stream == null) throw new IOException("无法打开保存位置");
            stream.write(content(call).getBytes(StandardCharsets.UTF_8)); stream.flush();
            response.put("cancelled", false); call.resolve(response);
        } catch (Exception e) { call.reject("文件未能导出，请重新选择保存位置", e); }
    }
    @PluginMethod public void importJson(PluginCall call) {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT); intent.addCategory(Intent.CATEGORY_OPENABLE); intent.setType("application/json");
        startActivityForResult(call, intent, "importResult");
    }
    @ActivityCallback private void importResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        JSObject response = new JSObject();
        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null) { response.put("cancelled", true); call.resolve(response); return; }
        try {
            response.put("content", read(getContext().getContentResolver().openInputStream(result.getData().getData())));
            response.put("cancelled", false); call.resolve(response);
        } catch (Exception e) { call.reject("文件无法读取或超过10MB，请选择有效JSON备份", e); }
    }
    @PluginMethod public void saveBefore(PluginCall call) {
        try {
            File dir = new File(getContext().getFilesDir(), "backups");
            if (!dir.isDirectory() && !dir.mkdirs()) throw new IOException("无法创建备份目录");
            File temporary = new File(dir, "pending-" + UUID.randomUUID() + ".tmp");
            try (FileOutputStream stream = new FileOutputStream(temporary)) { stream.write(content(call).getBytes(StandardCharsets.UTF_8)); stream.getFD().sync(); }
            File saved = new File(dir, "before-" + System.currentTimeMillis() + "-" + UUID.randomUUID() + ".json");
            if (!temporary.renameTo(saved)) throw new IOException("无法保存恢复前备份");
            call.resolve();
        } catch (Exception e) { call.reject("恢复前备份未能保存，恢复已停止", e); }
    }
    @PluginMethod public void readBefore(PluginCall call) {
        File dir = new File(getContext().getFilesDir(), "backups");
        File[] candidates = dir.listFiles((d, name) -> name.startsWith("before-") && name.endsWith(".json"));
        File latest = null;
        if (candidates != null) for (File f : candidates) if (latest == null || f.lastModified() > latest.lastModified()) latest = f;
        try { JSObject response = new JSObject(); if (latest != null) response.put("content", read(new FileInputStream(latest))); call.resolve(response); }
        catch (Exception e) { call.reject("恢复前备份无法读取", e); }
    }
}
