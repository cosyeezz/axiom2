package com.axiom2.android;

import android.app.Instrumentation;
import android.content.Intent;
import android.content.SharedPreferences;
import android.view.KeyEvent;
import android.view.View;
import android.webkit.ValueCallback;
import android.widget.TextView;
import com.axiom.sdk.AxiomWebView;
import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicReference;

import static com.axiom2.android.QrInstrumentationChecks.*;

/** Exercises the existing Back entry point; never connects to a real Tailnet computer. */
final class ConnectionSwitchChecks {
    private static final String A = "http://100.64.0.1:4317", B = "http://100.64.0.2:4317", C = "http://100.64.0.3:4317";
    private static final class FakeWeb extends AxiomWebView {
        final List<String> connections = new ArrayList<>();
        boolean history, deferred;
        int cleared, wentBack, evaluations;
        ValueCallback<String> pendingBack;
        FakeWeb(MainActivity activity) { super(activity); }
        @Override public void connect(String endpoint) { connections.add(endpoint); }
        @Override public boolean canGoBack() { return history; }
        @Override public void goBack() { wentBack++; history = false; }
        @Override public void clearHistory() { cleared++; history = false; }
        @Override public void evaluateJavascript(String script, ValueCallback<String> callback) {
            if (callback == null) return;
            evaluations++;
            if (deferred) pendingBack = callback; else callback.onReceiveValue("false");
        }
    }
    private static MainActivity start(Instrumentation test) {
        return (MainActivity) test.startActivitySync(new Intent(test.getTargetContext(), MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
    }
    private static SharedPreferences prefs(MainActivity activity) { return activity.getSharedPreferences("connection", 0); }
    private static void seed(MainActivity activity, String history, String current) throws Exception {
        prefs(activity).edit().putString("history", history).putString("last", current).commit();
        set(activity, "connectingAddress", current); set(activity, "loaded", true); set(activity, "connecting", false);
        ((View) get(activity, "status")).setVisibility(View.GONE);
    }
    static void racesAndFailures(Instrumentation test) throws Exception {
        MainActivity activity = start(test);
        AxiomWebView original = (AxiomWebView) get(activity, "web");
        AxiomWebView.Listener listener = (AxiomWebView.Listener) get(original, "listener");
        FakeWeb[] fake = new FakeWeb[1];
        try {
            test.runOnMainSync(() -> {
                try {
                    fake[0] = new FakeWeb(activity); set(activity, "web", fake[0]);
                    FakeWeb web = fake[0]; String saved = String.join("\n", A, B, C);
                    seed(activity, saved, A);
                    for (String expected : new String[]{B, C, A, B, C, A}) {
                        activity.onBackPressed();
                        check(web.connections.get(web.connections.size() - 1).equals(expected), "Cycle skipped a saved endpoint");
                        String previous = prefs(activity).getString("last", "");
                        check(!previous.equals(expected), "Saved connection before readiness");
                        web.history = true; listener.onReady();
                        check(!web.history && prefs(activity).getString("last", "").equals(expected), "Ready did not clear old history or save endpoint");
                        check(prefs(activity).getString("history", "").equals(saved), "Cycling reordered the saved list");
                    }
                    int count = web.connections.size(); web.history = true;
                    activity.onBackPressed(); check(web.wentBack == 1 && web.connections.size() == count, "Page history did not take priority");
                    web.deferred = true; int evaluations = web.evaluations;
                    activity.onBackPressed(); activity.onBackPressed();
                    check(web.evaluations == evaluations + 1, "Concurrent Back requests were not coalesced");
                    ValueCallback<String> delayed = web.pendingBack; delayed.onReceiveValue("false"); delayed.onReceiveValue("false");
                    check(web.connections.size() == count + 1, "Repeated Back callback connected twice");
                    listener.onError("fixture failure"); listener.onReady();
                    check(prefs(activity).getString("last", "").equals(A) && prefs(activity).getString("history", "").equals(saved), "Failed connection changed successful history");
                    seed(activity, saved, A); activity.onBackPressed(); delayed = web.pendingBack;
                    listener.onError("fixture navigation changed"); delayed.onReceiveValue("false");
                    check(web.connections.size() == count + 1, "Stale Back callback connected after failure");
                    web.deferred = false; seed(activity, saved, A); activity.onBackPressed();
                    ((View) get(activity, "cancel")).performClick(); listener.onReady();
                    check(prefs(activity).getString("last", "").equals(A), "Cancelled cycle saved a connection");
                    ((TextView) get(activity, "address")).setText(C); ((View) get(activity, "retry")).performClick(); listener.onReady();
                    check(prefs(activity).getString("history", "").equals(String.join("\n", C, A, B)), "Manual connections lost MRU behavior");
                    seed(activity, A, A); activity.onBackPressed(); listener.onReady();
                    check(web.connections.get(web.connections.size() - 1).equals(A) && prefs(activity).getString("history", "").equals(A), "Single saved endpoint did not wrap to itself");
                    seed(activity, "", A); count = web.connections.size(); activity.onBackPressed();
                    check(web.connections.size() == count && ((View) get(activity, "status")).getVisibility() == View.VISIBLE, "Empty history did not return to address entry");
                    check(web.cleared == 8, "A new connection retained old WebView history");
                } catch (Exception e) { throw new AssertionError(e); }
            });
        } finally {
            test.runOnMainSync(() -> { try { set(activity, "web", original); if (fake[0] != null) fake[0].destroy(); activity.finish(); } catch (Exception e) { throw new AssertionError(e); } });
            test.waitForIdleSync();
        }
    }
    private static String javascript(Instrumentation test, AxiomWebView web, String script) throws Exception {
        AtomicReference<String> result = new AtomicReference<>(); CountDownLatch done = new CountDownLatch(1);
        test.runOnMainSync(() -> web.evaluateJavascript(script, value -> { result.set(value); done.countDown(); }));
        check(done.await(10, TimeUnit.SECONDS), "WebView JavaScript timed out"); return result.get();
    }
    private static String page(String url) {
        android.net.Uri uri = android.net.Uri.parse(url);
        return uri.getScheme() + "://" + uri.getAuthority() + uri.getPath();
    }
    private static boolean nativeHistory(Instrumentation test, AxiomWebView web, String endpoint, String path, int index, int size) {
        AtomicReference<Boolean> result = new AtomicReference<>(false);
        test.runOnMainSync(() -> {
            android.webkit.WebBackForwardList list = web.copyBackForwardList();
            result.set(list.getCurrentIndex() == index && list.getSize() == size
                && page(list.getCurrentItem().getUrl()).equals(endpoint + path)
                && web.canGoBack() == (index > 0)
                && (index == 0 || page(list.getItemAtIndex(index - 1).getUrl()).equals(endpoint + "/")));
        }); return result.get();
    }
    private static String navigation(Instrumentation test, MainActivity activity, AxiomWebView web) {
        AtomicReference<String> result = new AtomicReference<>();
        test.runOnMainSync(() -> {
            android.webkit.WebBackForwardList list = web.copyBackForwardList();
            List<String> urls = new ArrayList<>();
            for (int i = 0; i < list.getSize(); i++) urls.add(list.getItemAtIndex(i).getUrl());
            result.set("url=" + web.getUrl() + ", index=" + list.getCurrentIndex() + ", history=" + urls + ", last=" + prefs(activity).getString("last", ""));
        }); return result.get();
    }
    private static void ready(Instrumentation test, MainActivity activity, String endpoint) throws Exception {
        waitFor(() -> {
            AtomicReference<Boolean> done = new AtomicReference<>(false);
            test.runOnMainSync(() -> { try { done.set((Boolean) get(activity, "loaded") && endpoint.equals(prefs(activity).getString("last", ""))); } catch (Exception e) { throw new AssertionError(e); } });
            return done.get();
        }, "Workstation did not become ready: " + endpoint);
    }
    private static void rootReady(Instrumentation test, MainActivity activity, AxiomWebView web, String endpoint) throws Exception {
        ready(test, activity, endpoint);
        try {
            waitFor(() -> nativeHistory(test, web, endpoint, "/", 0, 1)
                && "true".equals(javascript(test, web, "location.origin === '" + endpoint + "' && location.pathname === '/'")), "Root history did not settle");
        } catch (AssertionError failure) { throw new AssertionError(failure.getMessage() + ": " + navigation(test, activity, web), failure); }
    }
    static void realWebView(Instrumentation test) throws Exception {
        try (Workstation first = new Workstation(); Workstation second = new Workstation(); Workstation third = new Workstation(); Workstation delayed = new Workstation()) {
            MainActivity activity = start(test); AxiomWebView web = (AxiomWebView) get(activity, "web");
            String a = first.endpoint(), b = second.endpoint(), c = third.endpoint(), saved = String.join("\n", a, b, c);
            try {
                test.runOnMainSync(() -> { try {
                    prefs(activity).edit().putString("history", saved).putString("last", a).commit();
                    ((TextView) get(activity, "address")).setText(a); ((View) get(activity, "retry")).performClick();
                } catch (Exception e) { throw new AssertionError(e); } });
                rootReady(test, activity, web, a);
                test.runOnMainSync(() -> {
                    web.requestFocus();
                    ((android.view.inputmethod.InputMethodManager) activity.getSystemService(android.content.Context.INPUT_METHOD_SERVICE)).hideSoftInputFromWindow(web.getWindowToken(), 0);
                });
                test.waitForIdleSync();
                javascript(test, web, "document.querySelector('#popover').showPopover()");
                test.sendKeyDownUpSync(KeyEvent.KEYCODE_BACK);
                waitFor(() -> "false".equals(javascript(test, web, "document.querySelector('#popover').matches(':popover-open')")), "Back did not dismiss popover");
                check(prefs(activity).getString("last", "").equals(a), "Popover Back switched connections");
                javascript(test, web, "document.querySelector('dialog').showModal()");
                test.sendKeyDownUpSync(KeyEvent.KEYCODE_BACK);
                waitFor(() -> "false".equals(javascript(test, web, "document.querySelector('dialog').open")), "Back did not dismiss dialog");
                javascript(test, web, "document.body.classList.add('history-open')");
                test.sendKeyDownUpSync(KeyEvent.KEYCODE_BACK);
                waitFor(() -> "false".equals(javascript(test, web, "document.body.classList.contains('history-open')")), "Back did not collapse history sidebar");
                test.runOnMainSync(() -> web.loadUrl(a + "/nested"));
                waitFor(() -> "true".equals(javascript(test, web, "location.origin === '" + a + "' && location.pathname === '/nested'")) && nativeHistory(test, web, a, "/nested", 1, 2), "Nested page did not reach native history");
                test.sendKeyDownUpSync(KeyEvent.KEYCODE_BACK);
                waitFor(() -> "true".equals(javascript(test, web, "location.origin === '" + a + "' && location.pathname === '/'")), "Page Back did not precede switching");
                check(prefs(activity).getString("last", "").equals(a), "Page Back changed connection");
                waitFor(() -> nativeHistory(test, web, a, "/", 0, 2), "Page Back did not reach native root history");
                for (String expected : new String[]{b, c, a, b, c, a}) {
                    test.sendKeyDownUpSync(KeyEvent.KEYCODE_BACK); rootReady(test, activity, web, expected);
                    test.runOnMainSync(() -> check(!web.canGoBack(), "Cross-workstation history leaked into Back"));
                    check(prefs(activity).getString("history", "").equals(saved), "Real cycle reordered saved endpoints");
                    if (expected.equals(b)) {
                        javascript(test, web, "history.pushState(null, '', '/secondary')");
                        // The renderer's evaluate callback can precede the native history update.
                        waitFor(() -> "true".equals(javascript(test, web, "location.origin === '" + b + "' && location.pathname === '/secondary'")) && nativeHistory(test, web, b, "/secondary", 1, 2), "Second workstation pushState did not reach native history");
                        String before = navigation(test, activity, web);
                        test.sendKeyDownUpSync(KeyEvent.KEYCODE_BACK);
                        try {
                            waitFor(() -> "true".equals(javascript(test, web, "location.origin === '" + b + "' && location.pathname === '/'")), "Second workstation page history was skipped");
                            check(prefs(activity).getString("last", "").equals(b), "Second workstation page Back switched connections");
                            ready(test, activity, b);
                            waitFor(() -> nativeHistory(test, web, b, "/", 0, 2), "Second workstation Back did not settle at root");
                            check(prefs(activity).getString("history", "").equals(saved), "Page Back reordered saved connections");
                        } catch (AssertionError failure) {
                            throw new AssertionError(failure.getMessage() + "; before: " + before + "; after: " + navigation(test, activity, web), failure);
                        }
                    }
                }
                delayed.blockStatus();
                test.runOnMainSync(() -> prefs(activity).edit().putString("history", String.join("\n", a, delayed.endpoint(), c)).commit());
                test.sendKeyDownUpSync(KeyEvent.KEYCODE_BACK);
                check(delayed.requested.await(5, TimeUnit.SECONDS), "Delayed workstation was not requested");
                test.runOnMainSync(() -> { try {
                    ((View) get(activity, "cancel")).performClick();
                    ((TextView) get(activity, "address")).setText(c); ((View) get(activity, "retry")).performClick();
                } catch (Exception e) { throw new AssertionError(e); } });
                ready(test, activity, c); delayed.release.countDown();
                check(delayed.replied.await(5, TimeUnit.SECONDS), "Delayed workstation never completed");
                test.waitForIdleSync();
                check("true".equals(javascript(test, web, "location.origin === '" + c + "'")), "Cancelled old response replaced the new workstation");
                ready(test, activity, c);
            } finally { test.runOnMainSync(activity::finish); test.waitForIdleSync(); }
        }
    }
    /** Three independent HTTP origins, real WebView load/readiness, no model or external networking. */
    private static final class Workstation implements AutoCloseable {
        private final ServerSocket server;
        private final ExecutorService worker = Executors.newSingleThreadExecutor();
        final CountDownLatch requested = new CountDownLatch(1), replied = new CountDownLatch(1), release = new CountDownLatch(1);
        private volatile boolean blocked;
        void blockStatus() { blocked = true; }
        Workstation() throws IOException {
            server = new ServerSocket(0, 8, InetAddress.getByName("127.0.0.1"));
            worker.submit(() -> {
                while (!server.isClosed()) try (Socket socket = server.accept()) {
                    socket.setSoTimeout(5000);
                    BufferedReader input = new BufferedReader(new InputStreamReader(socket.getInputStream(), StandardCharsets.UTF_8));
                    String request = input.readLine(), line;
                    while ((line = input.readLine()) != null && !line.isEmpty()) { }
                    boolean status = request != null && request.contains(" /api/status ");
                    if (status && blocked) {
                        requested.countDown();
                        try { release.await(15, TimeUnit.SECONDS); } catch (InterruptedException e) { Thread.currentThread().interrupt(); }
                    }
                    String html = "<!doctype html><div id='app'><span class='connection-status' data-connected='true'>Fixture ready</span></div><div id='popover' popover>Menu</div><dialog>Details</dialog><button id='collapse-history' onclick=\"document.body.classList.remove('history-open')\">Close history</button>";
                    byte[] body = (status ? "{\"connected\":true}" : html).getBytes(StandardCharsets.UTF_8);
                    OutputStream out = socket.getOutputStream();
                    out.write(("HTTP/1.1 200 OK\r\nContent-Type: " + (status ? "application/json" : "text/html; charset=utf-8") + "\r\nContent-Length: " + body.length + "\r\nConnection: close\r\n\r\n").getBytes(StandardCharsets.UTF_8));
                    out.write(body); out.flush();
                } catch (IOException ignored) { /* Closing the fixture or a cancelled request is expected. */ }
                finally { if (blocked) replied.countDown(); }
            });
        }
        String endpoint() { return "http://127.0.0.1:" + server.getLocalPort(); }
        public void close() throws IOException { release.countDown(); server.close(); worker.shutdownNow(); }
    }
}
