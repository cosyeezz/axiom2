package com.axiom2.android;

import android.app.Activity;
import android.app.AlertDialog;
import android.app.Instrumentation;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.ActivityInfo;
import android.graphics.Bitmap;
import android.os.Bundle;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.widget.*;
import java.io.*;
import java.lang.reflect.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.*;

/** Runs only in the separately packaged com.axiom2.android.tailnettest application. */
public final class TailnetInstrumentation extends Instrumentation {
    private Bundle arguments;
    private int passed;
    private static final String SECRET = "fake-client-secret+&=unit-test";
    private static final String DEVICE = "{\"devices\":[{\"id\":\"1\",\"hostname\":\"My computer\",\"addresses\":[\"100.64.0.2\",\"fd7a:115c:a1e0::2\"],\"connectedToControl\":true}]}";
    private static final String TOKEN = "{\"access_token\":\"fake-scoped-token\",\"token_type\":\"Bearer\",\"expires_in\":3600}";
    private interface Checked { void run() throws Exception; }
    private interface Condition { boolean get() throws Exception; }
    @Override public void onCreate(Bundle arguments) { super.onCreate(arguments); this.arguments = arguments; start(); }
    @Override public void onStart() {
        Bundle result = new Bundle();
        try {
            check(getTargetContext().getPackageName().endsWith(".tailnettest"), "Refuse to run against production application");
            if ("restart".equals(arguments.getString("phase"))) {
                test("encrypted configuration survives process restart", () -> {
                    TailnetApi.Credentials saved = new TailnetCredentialStore(getTargetContext()).load();
                    check(saved != null && saved.secret.equals(SECRET) && saved.port == 4317, "Saved configuration missing after restart");
                    new TailnetCredentialStore(getTargetContext()).clear();
                });
                test("QR connection history survives process restart", () -> check(getTargetContext().getSharedPreferences("connection",0).getString("last","").equals(QrInstrumentationChecks.ENDPOINT), "QR history missing after restart"));
            } else {
                test("literal Tailnet address boundary", this::addresses);
                test("strict inventory and cloud-state parsing", this::parsing);
                test("read-only OAuth exchange and errors", this::authorization);
                test("IPv6 fallback and service readiness", this::probes);
                test("bounded HTTP, redirect refusal and cancellation", this::http);
                test("Keystore encryption, corruption and removal", this::storage);
                test("native selection, stale callbacks, configuration and lifecycle", this::ui);
                test("cyclic Back switching, readiness, cancellation and stale callbacks", () -> ConnectionSwitchChecks.racesAndFailures(this));
                test("real WebView Back priorities and three-workstation wraparound", () -> ConnectionSwitchChecks.realWebView(this));
                test("QR address contract and rotated camera frames", QrInstrumentationChecks::contract);
                test("QR camera permission, pause, resume and cancellation", () -> QrInstrumentationChecks.lifecycle(this));
                test("QR results, failure, readiness and successful history", () -> QrInstrumentationChecks.results(this));
                new TailnetCredentialStore(getTargetContext()).save(credentials());
            }
            result.putString("AXIOM_TAILNET_PASS", "true"); result.putInt("passed", passed); finish(Activity.RESULT_OK, result);
        } catch (Throwable error) {
            result.putString("AXIOM_TAILNET_PASS", "false"); result.putInt("passed", passed);
            StringWriter text = new StringWriter(); error.printStackTrace(new PrintWriter(text)); result.putString("failure", text.toString()); finish(Activity.RESULT_CANCELED, result);
        }
    }
    private void test(String name, Checked body) throws Exception { body.run(); passed++; Bundle status = new Bundle(); status.putString("test", name); status.putString("result", "PASS"); sendStatus(0, status); }
    private static void check(boolean value, String message) { if (!value) throw new AssertionError(message); }
    private static void fails(Checked body, String name) throws Exception { try { body.run(); } catch (IOException expected) { return; } throw new AssertionError("Accepted " + name); }
    private static TailnetApi.Credentials credentials() throws IOException { return new TailnetApi.Credentials("-", "fake-client-id", SECRET, 4317); }
    private void addresses() throws Exception {
        for (String address : new String[]{"100.64.0.1", "100.127.255.255", "fd7a:115c:a1e0::1", "FD7A:115C:A1E0:0:0:0:0:2"}) check(TailnetApi.isTailnetIp(address), "Rejected Tailnet address " + address);
        for (String address : new String[]{"127.0.0.1", "100.63.0.1", "100.128.0.1", "100.064.0.1", "100.64.256.1", "100.64.0.1.evil", "localhost", "::1", "fd7a:115c:a1e1::1", "fd7a:115c:a1e0::1%wlan0", "https://100.64.0.1", "100.64.0.1\n"}) check(!TailnetApi.isTailnetIp(address), "Accepted unsafe address " + address);
        fails(() -> new TailnetApi.Credentials("../wrong", "id", SECRET, 4317), "Tailnet path injection");
        fails(() -> new TailnetApi.Credentials("-", "id\nInjected", SECRET, 4317), "credential newline");
        fails(() -> new TailnetApi.Credentials("-", "id", SECRET, 65536), "invalid port");
    }
    private void parsing() throws Exception {
        List<TailnetApi.Device> devices = TailnetApi.parseDevices(DEVICE);
        check(devices.size() == 1 && devices.get(0).addresses.size() == 2 && Boolean.TRUE.equals(devices.get(0).connectedToControl), "Device fields missing");
        String mixed = "{\"devices\":[{\"id\":\"2\",\"name\":\"Fallback name\",\"addresses\":[\"127.0.0.1\",\"example.com\",\"fd7a:115c:a1e0::2\"]},{\"id\":\"3\",\"hostname\":\"A\",\"addresses\":[],\"connectedToControl\":false}]}";
        devices = TailnetApi.parseDevices(mixed);
        check(devices.get(0).name.equals("A") && Boolean.FALSE.equals(devices.get(0).connectedToControl), "Sort or offline state wrong");
        check(devices.get(1).addresses.size() == 1 && devices.get(1).connectedToControl == null, "Missing status must stay unknown");
        for (String bad : new String[]{"{}", "{\"devices\":false}", "<html>error</html>", "{\"devices\":[{}]}", DEVICE.replace("\"id\":\"1\"", "\"id\":\"\"")}) fails(() -> TailnetApi.parseDevices(bad), "malformed inventory");
        StringBuilder many = new StringBuilder("{\"devices\":[");
        for (int i = 0; i < 1001; i++) { if (i != 0) many.append(','); many.append("{\"id\":\"").append(i).append("\",\"addresses\":[]}"); }
        many.append("]}"); fails(() -> TailnetApi.parseDevices(many.toString()), "oversized inventory");
    }
    private void authorization() throws Exception {
        AtomicInteger exchanges = new AtomicInteger();
        TailnetApi api = new TailnetApi((url, bearer, form, limit, timeout, cancel) -> {
            check(url.startsWith("https://api.tailscale.com/api/v2/"), "Unexpected auth destination");
            if (url.endsWith("/oauth/token")) {
                exchanges.incrementAndGet(); check(bearer == null && form.contains("scope=devices%3Acore%3Aread"), "Read-only scope missing");
                check(form.contains("fake-client-secret%2B%26%3Dunit-test"), "Secret form encoding wrong"); return new TailnetApi.Reply(200, TOKEN);
            }
            check(url.contains("/tailnet/-/devices") && "fake-scoped-token".equals(bearer) && form == null, "Invalid inventory request"); return new TailnetApi.Reply(200, DEVICE);
        });
        api.devices(credentials(), new TailnetApi.Cancel()); api.devices(credentials(), new TailnetApi.Cancel());
        check(exchanges.get() == 2, "Refresh must request a new short-lived token, not persist old tokens");
        for (int code : new int[]{400, 401, 403, 404, 429, 500, 302}) {
            TailnetApi failing = new TailnetApi((url, bearer, form, limit, timeout, cancel) -> new TailnetApi.Reply(code, SECRET));
            try { failing.devices(credentials(), new TailnetApi.Cancel()); throw new AssertionError("Accepted HTTP " + code); }
            catch (IOException error) { check(!TailnetApi.failure(error).contains(SECRET), "Upstream body leaked"); }
        }
        TailnetApi broken = new TailnetApi((url, bearer, form, limit, timeout, cancel) -> new TailnetApi.Reply(200, "{\"access_token\":\"bad\\nheader\"}"));
        fails(() -> broken.devices(credentials(), new TailnetApi.Cancel()), "token header injection");
        TailnetApi.Cancel cancelled = new TailnetApi.Cancel(); cancelled.cancel(); fails(cancelled::check, "cancelled operation");
    }
    private void probes() throws Exception {
        AtomicInteger requests = new AtomicInteger();
        TailnetApi api = new TailnetApi((url, bearer, form, limit, timeout, cancel) -> {
            check(bearer == null && form == null, "Cloud credentials reached a computer"); requests.incrementAndGet();
            return new TailnetApi.Reply(200, url.contains("[") ? "{\"connected\":true}" : "{\"connected\":false}");
        });
        TailnetApi.Probe probe = api.probe(TailnetApi.parseDevices(DEVICE).get(0), 4320, new TailnetApi.Cancel());
        check(probe.reachable && probe.endpoint.equals("http://[fd7a:115c:a1e0::2]:4320") && requests.get() == 2, "IPv6 fallback or port ignored");
        TailnetApi wrong = new TailnetApi((url, bearer, form, limit, timeout, cancel) -> new TailnetApi.Reply(200, "{\"connected\":\"true\"}"));
        check(!wrong.probe(TailnetApi.parseDevices(DEVICE).get(0), 4317, new TailnetApi.Cancel()).reachable, "String readiness accepted");
    }
    private TailnetApi.Reply request(TailnetApi api, String url, int limit, int timeout, TailnetApi.Cancel cancel) throws Exception {
        Method method = TailnetApi.class.getDeclaredMethod("request", String.class, String.class, String.class, int.class, int.class, TailnetApi.Cancel.class); method.setAccessible(true);
        try { return (TailnetApi.Reply) method.invoke(api, url, "fake-test-header", null, limit, timeout, cancel); }
        catch (InvocationTargetException e) { if (e.getCause() instanceof Exception) throw (Exception) e.getCause(); throw e; }
    }
    private void http() throws Exception {
        try (TailnetApi api = new TailnetApi(); ServerSocket server = new ServerSocket(0, 4, InetAddress.getByName("127.0.0.1"))) {
            AtomicInteger connections = new AtomicInteger(); CountDownLatch stalled = new CountDownLatch(1);
            ExecutorService serving = Executors.newSingleThreadExecutor();
            Future<?> job = serving.submit(() -> {
                try {
                    for (int i = 0; i < 4; i++) try (Socket socket = server.accept()) {
                        connections.incrementAndGet(); socket.setSoTimeout(3000);
                        BufferedReader input = new BufferedReader(new InputStreamReader(socket.getInputStream(), StandardCharsets.UTF_8));
                        String path = input.readLine(); while (!"".equals(input.readLine())) { }
                        OutputStream out = socket.getOutputStream();
                        if (path.contains("redirect")) out.write(("HTTP/1.1 302 Found\r\nLocation: http://127.0.0.1:" + server.getLocalPort() + "/leaked\r\nContent-Length: 0\r\n\r\n").getBytes(StandardCharsets.UTF_8));
                        else if (path.contains("large")) { out.write("HTTP/1.1 200 OK\r\nContent-Length: 2000\r\n\r\n".getBytes(StandardCharsets.UTF_8)); out.write(new byte[2000]); }
                        else if (path.contains("slow")) { out.write("HTTP/1.1 200 OK\r\nContent-Length: 100\r\n\r\n".getBytes(StandardCharsets.UTF_8)); out.flush(); for (int n = 0; n < 12; n++) { out.write('x'); out.flush(); Thread.sleep(60); } }
                        else { stalled.countDown(); Thread.sleep(700); }
                        out.flush();
                    } catch (Exception ignored) { /* A client deadline must not stop accepting later cases. */ }
                } catch (Exception ignored) { }
            });
            String base = "http://127.0.0.1:" + server.getLocalPort();
            check(request(api, base + "/redirect", 8192, 1000, new TailnetApi.Cancel()).code == 302, "Followed redirect");
            check(connections.get() == 1, "Bearer sent to redirect target");
            fails(() -> request(api, base + "/large", 1024, 1000, new TailnetApi.Cancel()), "large response");
            fails(() -> request(api, base + "/slow", 1024, 180, new TailnetApi.Cancel()), "slow drip deadline");
            // A disconnected slow-drip socket may end the serving loop; use a separate cancellation server.
            job.cancel(true); serving.shutdownNow();
        }
        try (TailnetApi api = new TailnetApi(); ServerSocket server = new ServerSocket(0, 1, InetAddress.getByName("127.0.0.1"))) {
            CountDownLatch accepted = new CountDownLatch(1); ExecutorService executor = Executors.newFixedThreadPool(2);
            Future<?> serving = executor.submit(() -> { try (Socket socket = server.accept()) { accepted.countDown(); Thread.sleep(3000); } catch (Exception ignored) { } });
            TailnetApi.Cancel cancel = new TailnetApi.Cancel();
            Future<?> pending = executor.submit(() -> { try { request(api, "http://127.0.0.1:" + server.getLocalPort(), 8192, 5000, cancel); } catch (Exception expected) { } });
            check(accepted.await(2, TimeUnit.SECONDS), "No HTTP connection"); cancel.cancel(); pending.get(2, TimeUnit.SECONDS); serving.cancel(true); executor.shutdownNow();
        }
    }
    private void storage() throws Exception {
        TailnetCredentialStore store = new TailnetCredentialStore(getTargetContext()); store.clear(); check(store.load() == null, "Clear did not remove configuration"); store.save(credentials());
        SharedPreferences prefs = getTargetContext().getSharedPreferences("tailnet-credentials", 0);
        String first = prefs.getString("encrypted", ""); check(!first.contains(SECRET) && !first.contains("fake-client-id"), "Plaintext stored");
        check(store.load().secret.equals(SECRET), "Keystore roundtrip failed"); store.save(credentials()); check(!prefs.getString("encrypted", "").equals(first), "AES GCM IV reused");
        prefs.edit().putString("encrypted", first.substring(0, first.length() - 5) + "AAAAA").commit(); fails(store::load, "corrupt ciphertext");
        check(prefs.contains("encrypted"), "Corruption silently overwrote saved configuration"); store.clear(); check(store.load() == null, "Removal failed");
    }
    private static Object member(Object object, String name) throws Exception { Field field = object.getClass().getDeclaredField(name); field.setAccessible(true); return field.get(object); }
    private static View find(View view, String text) {
        if (view instanceof TextView && ((TextView) view).getText().toString().startsWith(text)) return view;
        if (view instanceof ViewGroup) for (int i = 0; i < ((ViewGroup) view).getChildCount(); i++) { View found = find(((ViewGroup) view).getChildAt(i), text); if (found != null) return found; }
        return null;
    }
    private void click(View root, String text) { runOnMainSync(() -> { View view = find(root, text); check(view != null && view.isEnabled(), "Missing enabled control: " + text); view.performClick(); }); }
    private void reveal(View root, String text) {
        runOnMainSync(() -> { View view = find(root, text); check(view != null, "Missing view: " + text); view.requestRectangleOnScreen(new android.graphics.Rect(0, 0, view.getWidth(), view.getHeight()), true); });
        waitForIdleSync();
    }
    private void tap(View root, String text) {
        reveal(root, text); android.graphics.Rect bounds = new android.graphics.Rect();
        runOnMainSync(() -> { View view = find(root, text); check(view.isEnabled() && view.getGlobalVisibleRect(bounds), "Touch target not visible"); });
        long time = android.os.SystemClock.uptimeMillis();
        android.view.MotionEvent down = android.view.MotionEvent.obtain(time, time, android.view.MotionEvent.ACTION_DOWN, bounds.centerX(), bounds.centerY(), 0);
        android.view.MotionEvent up = android.view.MotionEvent.obtain(time, time + 40, android.view.MotionEvent.ACTION_UP, bounds.centerX(), bounds.centerY(), 0);
        try { sendPointerSync(down); sendPointerSync(up); } finally { down.recycle(); up.recycle(); }
        waitForIdleSync();
    }
    private void waitFor(Condition condition) throws Exception { long until = System.nanoTime() + TimeUnit.SECONDS.toNanos(8); while (!condition.get()) { if (System.nanoTime() > until) throw new AssertionError("UI wait timed out"); Thread.sleep(40); } }
    private boolean contains(View root, String text) { AtomicBoolean value = new AtomicBoolean(); runOnMainSync(() -> value.set(find(root, text) != null)); return value.get(); }
    private void screenshot(String name) throws Exception {
        waitForIdleSync(); File directory = new File(getTargetContext().getExternalFilesDir(null), "tailnet-tests"); check(directory.mkdirs() || directory.isDirectory(), "Screenshot folder failed");
        Bitmap image = getUiAutomation().takeScreenshot(); check(image != null, "Screenshot unavailable");
        try (FileOutputStream output = new FileOutputStream(new File(directory, name + ".png"))) { image.compress(Bitmap.CompressFormat.PNG, 100, output); } finally { image.recycle(); }
    }
    private void ui() throws Exception {
        TailnetCredentialStore store = new TailnetCredentialStore(getTargetContext()); store.save(credentials());
        AtomicReference<String> response = new AtomicReference<>(DEVICE); AtomicReference<CountDownLatch> blocked = new AtomicReference<>(); CountDownLatch entered = new CountDownLatch(1);
        TailnetApi api = new TailnetApi((url, bearer, form, limit, timeout, cancel) -> {
            if (url.endsWith("oauth/token")) return new TailnetApi.Reply(200, TOKEN);
            if (url.contains("/devices")) {
                String snapshot = response.get(); CountDownLatch latch = blocked.getAndSet(null);
                if (latch != null) { entered.countDown(); boolean done = false; while (!done) try { done = latch.await(5, TimeUnit.SECONDS); } catch (InterruptedException ignored) { } }
                return new TailnetApi.Reply(200, snapshot);
            }
            return new TailnetApi.Reply(200, "{\"connected\":true}");
        });
        Intent intent = new Intent(); intent.setClassName(getTargetContext(), "com.axiom2.android.MainActivity"); intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        Activity activity = startActivitySync(intent); AtomicReference<TailnetPanel> holder = new AtomicReference<>(); AtomicReference<String> selected = new AtomicReference<>();
        runOnMainSync(() -> {
            try {
                TailnetPanel old = (TailnetPanel) member(activity, "tailnet"); ViewGroup parent = (ViewGroup) old.getParent(); int position = parent.indexOfChild(old); ViewGroup.LayoutParams params = old.getLayoutParams(); old.close(); parent.removeView(old);
                TailnetPanel panel = new TailnetPanel(activity, selected::set, api); holder.set(panel); parent.addView(panel, position, params);
                Field field = MainActivity.class.getDeclaredField("tailnet"); field.setAccessible(true); field.set(activity, panel);
            } catch (Exception e) { throw new AssertionError(e); }
        });
        TailnetPanel panel = holder.get();
        try {
            click(panel, "选择 Tailscale 设备"); waitFor(() -> contains(panel, "My computer") && !((Boolean) member(panel, "busy")));
            waitFor(() -> { AtomicBoolean done = new AtomicBoolean(); runOnMainSync(() -> { TextView row = (TextView) find(panel, "My computer"); done.set(row != null && row.getText().toString().contains("服务可达")); }); return done.get(); });
            screenshot("01-device-list-portrait"); tap(panel, "My computer"); check("http://100.64.0.2:4317".equals(selected.get()), "Selection did not return endpoint");
            click(panel, "选择 Tailscale 设备"); waitFor(() -> contains(panel, "My computer") && !((Boolean) member(panel, "busy")));
            CountDownLatch release = new CountDownLatch(1); blocked.set(release); click(panel, "刷新设备"); check(entered.await(3, TimeUnit.SECONDS), "Delayed request not reached");
            click(panel, "取消加载"); response.set(DEVICE.replace("My computer", "New computer")); click(panel, "刷新设备");
            try { waitFor(() -> contains(panel, "New computer")); } finally { release.countDown(); }
            Thread.sleep(200); check(!contains(panel, "My computer"), "Late request repainted old inventory");
            click(panel, "配置设备发现"); AlertDialog dialog = (AlertDialog) member(panel, "dialog");
            check((dialog.getWindow().getAttributes().flags & WindowManager.LayoutParams.FLAG_SECURE) != 0, "Credential window not protected");
            AtomicReference<EditText> password = new AtomicReference<>();
            runOnMainSync(() -> {
                findPassword(dialog.getWindow().getDecorView(), password); check(password.get() != null && password.get().length() == 0, "Saved secret was exposed in form");
                password.get().setText("replacement-fake-secret"); dialog.getButton(AlertDialog.BUTTON_NEGATIVE).performClick();
            });
            waitForIdleSync();
            check(password.get().length() == 0 && store.load().secret.equals(SECRET), "Cancel saved or retained secret draft");
            click(panel, "配置设备发现");
            runOnMainSync(() -> { try { ((AlertDialog) member(panel, "dialog")).getButton(AlertDialog.BUTTON_NEUTRAL).performClick(); } catch (Exception e) { throw new AssertionError(e); } });
            check(member(panel, "removalDialog") != null, "Removal confirmation missing");
            runOnMainSync(panel::pause); waitForIdleSync();
            check(member(panel, "removalDialog") == null && member(panel, "dialog") == null && store.load() != null, "Pause retained confirmation or deleted credentials");
            runOnMainSync(panel::resume); waitFor(() -> contains(panel, "New computer"));
            click(panel, "配置设备发现");
            runOnMainSync(() -> { try { ((AlertDialog) member(panel, "dialog")).getButton(AlertDialog.BUTTON_POSITIVE).performClick(); } catch (Exception e) { throw new AssertionError(e); } });
            waitFor(() -> contains(panel, "New computer") && !((Boolean) member(panel, "busy")));
            check(store.load().secret.equals(SECRET), "Blank secret did not preserve saved configuration");
            runOnMainSync(() -> activity.setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE)); Thread.sleep(600); reveal(panel, "New computer"); screenshot("02-device-list-landscape");
            runOnMainSync(panel::pause); check(!contains(panel, "New computer"), "Background retained stale inventory");
            runOnMainSync(panel::resume); waitFor(() -> contains(panel, "New computer"));
            runOnMainSync(() -> panel.setAvailable(false)); check(panel.getVisibility() == View.GONE, "Discovery still visible while connecting");
            runOnMainSync(() -> panel.setAvailable(true)); waitFor(() -> contains(panel, "New computer"));
            runOnMainSync(() -> activity.setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_PORTRAIT)); Thread.sleep(600);
            StringBuilder inventory = new StringBuilder("{\"devices\":[");
            for (int i = 1; i <= 12; i++) { if (i > 1) inventory.append(','); inventory.append(String.format(Locale.ROOT, "{\"id\":\"%d\",\"hostname\":\"Node %02d\",\"addresses\":[\"100.64.0.%d\"]}", i, i, i)); }
            response.set(inventory.append("]}").toString()); click(panel, "刷新设备"); waitFor(() -> contains(panel, "第 1 / 2 页"));
            check(!contains(panel, "Node 11"), "First page exceeded ten devices"); click(panel, "下一页"); check(contains(panel, "Node 11"), "Second page missing");
            runOnMainSync(() -> { try { ((EditText) member(panel, "search")).setText("Node 01"); } catch (Exception e) { throw new AssertionError(e); } });
            waitFor(() -> contains(panel, "第 1 / 1 页") && contains(panel, "Node 01")); check(!contains(panel, "Node 11"), "Search retained old page"); screenshot("03-search-results");
            orderedRemoval(activity);
        } finally { runOnMainSync(activity::finish); waitForIdleSync(); }
    }
    private void orderedRemoval(Activity activity) throws Exception {
        CountDownLatch release = new CountDownLatch(1); AtomicReference<TailnetPanel> replacement = new AtomicReference<>();
        TailnetCredentialStore.SERIAL.submit(() -> { try { release.await(5, TimeUnit.SECONDS); } catch (InterruptedException e) { Thread.currentThread().interrupt(); } });
        try {
            runOnMainSync(() -> {
                try {
                    Method persist = TailnetPanel.class.getDeclaredMethod("persist", TailnetApi.Credentials.class); persist.setAccessible(true);
                    TailnetPanel old = new TailnetPanel(activity, value -> { });
                    persist.invoke(old, credentials()); old.close();
                    TailnetPanel fresh = new TailnetPanel(activity, value -> { }); replacement.set(fresh);
                    Field saved = TailnetPanel.class.getDeclaredField("credentials"); saved.setAccessible(true); saved.set(fresh, credentials());
                    persist.invoke(fresh, new Object[]{null});
                    check(member(fresh, "credentials") == null, "Removal retained old secret while queued");
                    ((Button) member(fresh, "cancel")).performClick();
                    check(member(fresh, "credentials") == null, "Cancelling wait restored removed secret");
                } catch (Exception e) { throw new AssertionError(e); }
            });
        } finally { release.countDown(); }
        TailnetCredentialStore.SERIAL.submit(() -> { }).get(5, TimeUnit.SECONDS);
        check(new TailnetCredentialStore(getTargetContext()).load() == null, "An old panel save restored removed credentials");
        runOnMainSync(() -> replacement.get().close());
    }
    private static void findPassword(View view, AtomicReference<EditText> result) {
        if (view instanceof EditText && ((((EditText) view).getInputType() & 0xfff) == 0x81)) result.set((EditText) view);
        if (view instanceof ViewGroup) for (int i = 0; i < ((ViewGroup) view).getChildCount(); i++) findPassword(((ViewGroup) view).getChildAt(i), result);
    }
}
