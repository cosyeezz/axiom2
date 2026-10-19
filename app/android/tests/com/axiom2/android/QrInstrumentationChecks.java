package com.axiom2.android;

import android.app.Activity;
import android.app.Instrumentation;
import android.content.Intent;
import android.os.Handler;
import android.view.View;
import android.view.accessibility.AccessibilityNodeInfo;
import android.widget.TextView;
import com.axiom.sdk.AxiomWebView;
import com.google.zxing.BarcodeFormat;
import com.google.zxing.common.BitMatrix;
import com.google.zxing.qrcode.QRCodeWriter;
import java.lang.reflect.Field;
import java.util.Arrays;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;

final class QrInstrumentationChecks {
    static final String ENDPOINT = "http://100.64.0.2:4317";
    static void check(boolean ok, String message) { if (!ok) throw new AssertionError(message); }
    static Object get(Object object, String name) throws Exception { Field f = object.getClass().getDeclaredField(name); f.setAccessible(true); return f.get(object); }
    static void set(Object object, String name, Object value) throws Exception { Field f = object.getClass().getDeclaredField(name); f.setAccessible(true); f.set(object, value); }
    interface Condition { boolean get() throws Exception; }
    static void waitFor(Condition c, String message) throws Exception { long end = System.currentTimeMillis() + 15000; while (System.currentTimeMillis() < end) { if (c.get()) return; Thread.sleep(100); } throw new AssertionError(message); }
    static void contract() throws Exception {
        for (String url : new String[]{ENDPOINT, "http://100.127.255.255:65535/", "http://100.64.0.0:1", "http://100.64.0.2:80/", "http://[fd7a:115c:a1e0::2]:4317/"}) check(ConnectionQr.address(url).equals(url.endsWith("/") ? url.substring(0,url.length()-1) : url), "Valid QR URL rejected");
        for (String bad : new String[]{"", "http://localhost:4317", "http://100.63.0.1:4317", "http://100.128.0.1:4317", "http://100.064.0.1:4317", "http://100.64.0.256:4317", "http://100.64.0.2", "https://100.64.0.2:4317", ENDPOINT+"?x=1", ENDPOINT+"#x", ENDPOINT+"/settings", ENDPOINT+"\n", "http://user@100.64.0.2:4317", "http://[fd7a:115c:a1e1::2]:4317", "http://[fd7a:115c:a1e0::2%25wlan0]:4317", "http://100.64.0.2:65536", "http://100.64.0.2:0", "http://100.64.0.2:04317", "javascript:alert(1)"}) {
            try { ConnectionQr.address(bad); throw new AssertionError("Unsafe QR accepted: " + bad); } catch (IllegalArgumentException expected) {}
        }
        for (String value : new String[]{ENDPOINT+"/", "http://[fd7a:115c:a1e0::2]:4317/"}) {
            BitMatrix matrix = new QRCodeWriter().encode(value, BarcodeFormat.QR_CODE, 264, 264);
            int width = 640, height = 480; byte[] frame = new byte[width * height]; Arrays.fill(frame, (byte)255);
            for (int y=0;y<264;y++) for (int x=0;x<264;x++) frame[(y+85)*width+x+100] = (byte)(matrix.get(x,y) ? 0 : 255);
            for (int direction=0;direction<4;direction++) {
                check(value.equals(ConnectionQr.decode(frame, width, height)), "QR frame rotation decode failed " + direction);
                byte[] rotated = new byte[frame.length];
                for (int y=0;y<height;y++) for (int x=0;x<width;x++) rotated[x*height+height-1-y] = frame[y*width+x];
                frame=rotated; int swap=width; width=height; height=swap;
            }
        }
        check(ConnectionQr.decode(new byte[640*480],640,480)==null, "Blank frame decoded");
        check(ConnectionQr.decode(new byte[8],640,480)==null && ConnectionQr.decode(null,0,0)==null, "Invalid frame was not bounded");
    }
    static boolean cameraOpen(QrScanActivity scanner) throws Exception {
        AtomicBoolean open = new AtomicBoolean(); CountDownLatch done = new CountDownLatch(1);
        Handler worker = (Handler)get(scanner,"worker");
        if (!worker.post(() -> { try { open.set(get(scanner,"camera") != null); } catch(Exception e) { throw new RuntimeException(e); } finally { done.countDown(); } })) return false;
        check(done.await(10,TimeUnit.SECONDS),"Camera worker stalled"); return open.get();
    }
    static void lifecycle(Instrumentation test) throws Exception {
        MainActivity activity = (MainActivity)test.startActivitySync(new Intent(test.getTargetContext(),MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
        try {
            test.runOnMainSync(() -> activity.getSharedPreferences("connection",0).edit().clear().commit());
            Instrumentation.ActivityMonitor monitor = test.addMonitor(QrScanActivity.class.getName(), null, false);
            test.runOnMainSync(() -> { try { ((View)get(activity,"scan")).performClick(); } catch(Exception e) { throw new RuntimeException(e); } });
            QrScanActivity scanner = (QrScanActivity)monitor.waitForActivityWithTimeout(10000); test.removeMonitor(monitor); check(scanner!=null,"Scan button did not open scanner");
            // Fresh isolated package: exercise the actual runtime-permission dialog, then cancel.
            waitFor(() -> {
                AccessibilityNodeInfo root = test.getUiAutomation().getRootInActiveWindow(); if(root==null)return false;
                for (String id : new String[]{"permission_deny_button","permission_deny_and_dont_ask_again_button"}) {
                    java.util.List<AccessibilityNodeInfo> nodes = root.findAccessibilityNodeInfosByViewId("com.android.permissioncontroller:id/"+id);
                    if(!nodes.isEmpty()) return nodes.get(0).performAction(AccessibilityNodeInfo.ACTION_CLICK);
                }
                return false;
            },"Permission denial button absent");
            waitFor(() -> { AtomicBoolean denied=new AtomicBoolean(); test.runOnMainSync(() -> { try { denied.set(((TextView)get(scanner,"status")).getText().toString().contains("未获得")); }catch(Exception e){throw new RuntimeException(e);} }); return denied.get(); },"Permission denial not shown");
            check(!cameraOpen(scanner),"Camera opened without permission");
            test.runOnMainSync(scanner::finish); test.waitForIdleSync();
            check(activity.getSharedPreferences("connection",0).getString("history","").isEmpty(),"Cancel saved history");
            try (android.os.ParcelFileDescriptor pipe = test.getUiAutomation().executeShellCommand("pm grant " + test.getTargetContext().getPackageName() + " android.permission.CAMERA"); java.io.FileInputStream input = new java.io.FileInputStream(pipe.getFileDescriptor())) { while(input.read()!=-1) {} }
            monitor = test.addMonitor(QrScanActivity.class.getName(), null, false);
            test.runOnMainSync(() -> { try { ((View)get(activity,"scan")).performClick(); } catch(Exception e) { throw new RuntimeException(e); } });
            QrScanActivity allowed = (QrScanActivity)monitor.waitForActivityWithTimeout(10000); test.removeMonitor(monitor); check(allowed!=null,"Granted scanner absent");
            waitFor(() -> cameraOpen(allowed),"Granted camera did not open");
            test.runOnMainSync(() -> test.callActivityOnPause(allowed)); waitFor(() -> !cameraOpen(allowed),"Pause retained camera");
            test.runOnMainSync(() -> test.callActivityOnResume(allowed)); waitFor(() -> cameraOpen(allowed),"Resume did not reopen camera");
            java.io.File directory = new java.io.File(test.getTargetContext().getExternalFilesDir(null),"tailnet-tests"); directory.mkdirs();
            android.graphics.Bitmap shot = test.getUiAutomation().takeScreenshot(); check(shot != null,"Scanner screenshot missing");
            try(java.io.FileOutputStream output = new java.io.FileOutputStream(new java.io.File(directory,"04-qr-scanner.png"))) { shot.compress(android.graphics.Bitmap.CompressFormat.PNG,100,output); } finally { shot.recycle(); }
            test.runOnMainSync(allowed::finish); test.waitForIdleSync();
            waitFor(() -> !cameraOpen(allowed),"Finished scanner retained camera");
        } finally { test.runOnMainSync(activity::finish); test.waitForIdleSync(); }
    }
    static void results(Instrumentation test) throws Exception {
        MainActivity activity=(MainActivity)test.startActivitySync(new Intent(test.getTargetContext(),MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
        final AxiomWebView[] original = new AxiomWebView[1], fake = new AxiomWebView[1]; final AxiomWebView.Listener[] listener = new AxiomWebView.Listener[1]; final int[] connects={0};
        try {
            test.runOnMainSync(() -> { try {
                original[0]=(AxiomWebView)get(activity,"web"); Field field=AxiomWebView.class.getDeclaredField("listener");field.setAccessible(true);listener[0]=(AxiomWebView.Listener)field.get(original[0]);
                fake[0]=new AxiomWebView(activity){ @Override public void connect(String address){check(ENDPOINT.equals(address),"Wrong scan endpoint");connects[0]++;} }; set(activity,"web",fake[0]);
                activity.getSharedPreferences("connection",0).edit().clear().commit();
                Intent valid=new Intent().putExtra(QrScanActivity.ADDRESS,ENDPOINT+"/");
                activity.onActivityResult(42,Activity.RESULT_OK,valid);check(connects[0]==0,"Unsolicited result connected");
                set(activity,"scanPending",true); activity.onActivityResult(42,Activity.RESULT_OK,new Intent().putExtra(QrScanActivity.ADDRESS,"http://evil.example:4317")); check(connects[0]==0,"Unsafe result connected");
                set(activity,"scanPending",true); activity.onActivityResult(42,Activity.RESULT_OK,valid);check(connects[0]==1,"Scan did not connect");
                activity.onActivityResult(42,Activity.RESULT_OK,valid);check(connects[0]==1,"Duplicate result connected");
                check(activity.getSharedPreferences("connection",0).getString("history","").isEmpty(),"Scan recognition saved history before ready");
                listener[0].onError("fixture failure"); check(activity.getSharedPreferences("connection",0).getString("history","").isEmpty(),"Connection failure saved history");
                set(activity,"scanPending",true);activity.onActivityResult(42,Activity.RESULT_OK,valid);listener[0].onReady();
                check(activity.getSharedPreferences("connection",0).getString("last","").equals(ENDPOINT),"Ready did not save endpoint");
                listener[0].onReady();check(activity.getSharedPreferences("connection",0).getString("history","").equals(ENDPOINT),"Ready duplicated history");
            } catch(Exception e){throw new RuntimeException(e);} });
        } finally { test.runOnMainSync(() -> {try{if(original[0]!=null)set(activity,"web",original[0]);if(fake[0]!=null)fake[0].destroy();activity.finish();}catch(Exception e){throw new RuntimeException(e);}});test.waitForIdleSync(); }
    }
}
