package com.axiom2.android;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.graphics.ImageFormat;
import android.hardware.Camera;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.HandlerThread;
import android.provider.Settings;
import android.view.Gravity;
import android.graphics.SurfaceTexture;
import android.view.TextureView;
import android.view.View;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;
import java.util.List;
import java.util.concurrent.atomic.AtomicInteger;

/** All camera operations and bounded, one-frame-at-a-time decoding share one worker. */
@SuppressWarnings("deprecation")
public final class QrScanActivity extends Activity implements TextureView.SurfaceTextureListener {
    static final String ADDRESS = "connection-address";
    private final Handler main = new Handler(android.os.Looper.getMainLooper());
    private final AtomicInteger generation = new AtomicInteger();
    private HandlerThread thread;
    private Handler worker;
    private Camera camera; // worker-owned
    private TextureView preview;
    private SurfaceTexture surface; // main-owned; retired textures are released by the camera worker
    private FrameLayout viewport;
    private TextView status;
    private Button permission;
    private int displayWidth, displayHeight;
    private boolean resumed, surfaceReady, requested, starting, delivered;

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        getWindow().setStatusBarColor(Color.rgb(15, 17, 21));
        getWindow().setNavigationBarColor(Color.rgb(15, 17, 21));
        thread = new HandlerThread("axiom-qr-camera"); thread.start(); worker = new Handler(thread.getLooper());
        LinearLayout root = new LinearLayout(this); root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(Color.rgb(15, 17, 21)); root.setPadding(dp(20), dp(16), dp(20), dp(16));
        TextView title = label("扫描电脑上的二维码", 21); root.addView(title);
        TextView hint = label("电脑 Axiom → 配置 → 手机连接\n手机与电脑都需连接 Tailscale。", 14); hint.setPadding(0, dp(10), 0, dp(16)); root.addView(hint);
        viewport = new FrameLayout(this); viewport.setBackgroundColor(Color.BLACK);
        root.addView(viewport, new LinearLayout.LayoutParams(-1, 0, 1));
        preview = new TextureView(this); viewport.addView(preview, new FrameLayout.LayoutParams(-1, -1, Gravity.CENTER));
        preview.setSurfaceTextureListener(this);
        viewport.addOnLayoutChangeListener((v,l,t,r,b,ol,ot,or,ob) -> fitPreview());
        status = label("将电脑上的二维码完整放入画面", 14); status.setPadding(0, dp(12), 0, dp(8)); status.setAccessibilityLiveRegion(View.ACCESSIBILITY_LIVE_REGION_POLITE); root.addView(status);
        permission = new Button(this); permission.setText("允许使用摄像头"); permission.setVisibility(View.GONE);
        permission.setOnClickListener(v -> {
            if (checkSelfPermission(Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) { stopCamera(); startCamera(); }
            else if (!requested || shouldShowRequestPermissionRationale(Manifest.permission.CAMERA)) askPermission();
            else startActivity(new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + getPackageName())));
        }); root.addView(permission);
        Button cancel = new Button(this); cancel.setText("取消扫码"); cancel.setOnClickListener(v -> finish()); root.addView(cancel);
        setContentView(root);
        requested = state != null && state.getBoolean("requested");
    }
    private void fitPreview() {
        if (displayWidth == 0 || displayHeight == 0) return;
        float scale = Math.min((float) viewport.getWidth() / displayWidth, (float) viewport.getHeight() / displayHeight);
        preview.setLayoutParams(new FrameLayout.LayoutParams(Math.max(1, Math.round(displayWidth * scale)), Math.max(1, Math.round(displayHeight * scale)), Gravity.CENTER));
    }
    private int dp(int n) { return Math.round(n * getResources().getDisplayMetrics().density); }
    private TextView label(String text, int size) { TextView view = new TextView(this); view.setText(text); view.setTextColor(Color.rgb(229, 231, 235)); view.setTextSize(size); return view; }
    private void askPermission() { requested = true; requestPermissions(new String[]{Manifest.permission.CAMERA}, 43); }
    @Override protected void onSaveInstanceState(Bundle state) { state.putBoolean("requested", requested); super.onSaveInstanceState(state); }
    @Override protected void onResume() {
        super.onResume(); resumed = true;
        if (checkSelfPermission(Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) startCamera();
        else if (!requested) askPermission(); else denied();
    }
    @Override protected void onPause() { resumed = false; stopCamera(); super.onPause(); }
    @Override protected void onDestroy() { retireSurface(); worker.post(() -> thread.quitSafely()); super.onDestroy(); }
    @Override public void onRequestPermissionsResult(int code, String[] names, int[] grants) {
        super.onRequestPermissionsResult(code, names, grants);
        if (code == 43 && !isFinishing()) {
            if (checkSelfPermission(Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) startCamera(); else denied();
        }
    }
    private void denied() {
        status.setText("未获得摄像头权限。可允许权限后重试，或返回手动连接。");
        permission.setText(shouldShowRequestPermissionRationale(Manifest.permission.CAMERA) ? "允许使用摄像头" : "打开应用权限设置"); permission.setVisibility(View.VISIBLE);
    }
    @Override public void onSurfaceTextureAvailable(SurfaceTexture texture, int width, int height) { if (surface != null) retireSurface(); surface = texture; surfaceReady = true; startCamera(); }
    @Override public void onSurfaceTextureSizeChanged(SurfaceTexture texture, int width, int height) {}
    @Override public void onSurfaceTextureUpdated(SurfaceTexture texture) {}
    @Override public boolean onSurfaceTextureDestroyed(SurfaceTexture texture) {
        if (surface == texture) retireSurface();
        // Retain ownership until the worker has stopped preview; never block the UI on Camera.open().
        return false;
    }
    private void retireSurface() {
        SurfaceTexture retired = surface; surface = null; surfaceReady = false; stopCamera();
        if (retired != null) worker.post(() -> { releaseCamera(); retired.release(); });
    }
    private boolean owns(int token) { return generation.get() == token; }
    private void stopCamera() { generation.incrementAndGet(); starting = false; if (worker != null) worker.post(this::releaseCamera); }
    private void releaseCamera() {
        if (camera == null) return;
        Camera old = camera; camera = null;
        try { old.setOneShotPreviewCallback(null); old.setErrorCallback(null); old.stopPreview(); } catch (RuntimeException ignored) {}
        try { old.release(); } catch (RuntimeException ignored) {}
    }
    private void startCamera() {
        if (!resumed || !surfaceReady || starting || delivered || isFinishing() || checkSelfPermission(Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) return;
        starting = true; permission.setVisibility(View.GONE); status.setText("将电脑上的二维码完整放入画面");
        final int token = generation.incrementAndGet();
        final SurfaceTexture target = surface;
        final int degrees = getWindowManager().getDefaultDisplay().getRotation() * 90;
        worker.post(() -> {
            if (!owns(token)) return;
            releaseCamera();
            try {
                int count = Camera.getNumberOfCameras(), id = -1;
                Camera.CameraInfo info = new Camera.CameraInfo();
                for (int i = 0; i < count; i++) { Camera.getCameraInfo(i, info); if (info.facing == Camera.CameraInfo.CAMERA_FACING_BACK) { id = i; break; } }
                if (id < 0) { failed(token, "此设备没有后置摄像头，请返回手动连接。"); return; }
                Camera.getCameraInfo(id, info); camera = Camera.open(id);
                if (!owns(token)) { releaseCamera(); return; }
                Camera.Parameters p = camera.getParameters();
                List<Camera.Size> sizes = p.getSupportedPreviewSizes();
                Camera.Size chosen = p.getPreviewSize(); long distance = Long.MAX_VALUE;
                for (Camera.Size size : sizes) {
                    long candidate = Math.abs((long) size.width * size.height - 1280 * 720);
                    if (candidate < distance) { chosen = size; distance = candidate; }
                }
                p.setPreviewSize(chosen.width, chosen.height); p.setPreviewFormat(ImageFormat.NV21);
                List<String> focus = p.getSupportedFocusModes();
                if (focus != null && focus.contains(Camera.Parameters.FOCUS_MODE_CONTINUOUS_PICTURE)) p.setFocusMode(Camera.Parameters.FOCUS_MODE_CONTINUOUS_PICTURE);
                else if (focus != null && focus.contains(Camera.Parameters.FOCUS_MODE_CONTINUOUS_VIDEO)) p.setFocusMode(Camera.Parameters.FOCUS_MODE_CONTINUOUS_VIDEO);
                else if (focus != null && focus.contains(Camera.Parameters.FOCUS_MODE_AUTO)) p.setFocusMode(Camera.Parameters.FOCUS_MODE_AUTO);
                camera.setParameters(p);
                Camera.Parameters actual = camera.getParameters(); Camera.Size size = actual.getPreviewSize();
                if (actual.getPreviewFormat() != ImageFormat.NV21) throw new IllegalStateException();
                int rotation = (info.orientation - degrees + 360) % 360;
                if (!owns(token)) { releaseCamera(); return; }
                camera.setDisplayOrientation(rotation); camera.setPreviewTexture(target);
                camera.setErrorCallback((error, source) -> failed(token, "摄像头暂不可用，请检查相机权限或隐私开关后重试。"));
                camera.startPreview();
                final int shownWidth = rotation % 180 == 0 ? size.width : size.height;
                final int shownHeight = rotation % 180 == 0 ? size.height : size.width;
                main.post(() -> { if (owns(token)) { displayWidth = shownWidth; displayHeight = shownHeight; fitPreview(); } });
                nextFrame(token, size.width, size.height);
                if (Camera.Parameters.FOCUS_MODE_AUTO.equals(actual.getFocusMode())) focus(token);
            } catch (Exception e) { failed(token, "无法打开摄像头，请检查权限、隐私开关或其他相机应用后重试。"); }
        });
    }
    private void focus(int token) {
        if (!owns(token) || camera == null) return;
        try { camera.autoFocus((success, source) -> {}); } catch (RuntimeException ignored) {}
        worker.postDelayed(() -> focus(token), 2000);
    }
    private void nextFrame(int token, int width, int height) {
        if (!owns(token) || camera == null) return;
        try {
            camera.setOneShotPreviewCallback((data, source) -> {
                if (!owns(token) || source != camera) return;
                String text = ConnectionQr.decode(data, width, height);
                if (text != null) {
                    try {
                        final String address = ConnectionQr.address(text);
                        releaseCamera();
                        main.post(() -> {
                            if (!owns(token) || !resumed || delivered || isFinishing()) return;
                            delivered = true; stopCamera(); setResult(RESULT_OK, new Intent().putExtra(ADDRESS, address)); finish();
                        });
                        return;
                    } catch (IllegalArgumentException invalid) {
                        main.post(() -> { if (owns(token) && !status.getText().toString().equals(invalid.getMessage())) status.setText(invalid.getMessage()); });
                    }
                }
                worker.postDelayed(() -> nextFrame(token, width, height), 120);
            });
        } catch (RuntimeException error) { failed(token, "摄像头已中断，可重试或返回手动连接。"); }
    }
    private void failed(int token, String message) {
        if (!owns(token)) return;
        releaseCamera();
        main.post(() -> { if (owns(token)) { starting = false; status.setText(message); permission.setText("重试摄像头"); permission.setVisibility(View.VISIBLE); } });
    }
}
