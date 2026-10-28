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

/** Exercises Back and independent touch switching; never connects to a real Tailnet computer. */
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
    private static void swipeCommand(MainActivity activity, int direction) throws Exception {
        java.lang.reflect.Method method = MainActivity.class.getDeclaredMethod("swipeConnection", int.class);
        method.setAccessible(true); method.invoke(activity, direction);
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
                    seed(activity, saved, A); web.deferred = false;
                    swipeCommand(activity, -1); swipeCommand(activity, -1); swipeCommand(activity, 1);
                    check(web.connections.subList(web.connections.size() - 3, web.connections.size()).equals(Arrays.asList(C, B, C)), "Rapid swipes did not advance from the pending target in both directions");
                    check(prefs(activity).getString("last", "").equals(A), "Pending swipe saved an unready endpoint");
                    listener.onError("fixture swipe failure"); swipeCommand(activity, -1); listener.onReady();
                    check(prefs(activity).getString("last", "").equals(B) && prefs(activity).getString("history", "").equals(saved), "Failed swipe could not recover without reordering history");
                    swipeCommand(activity, 1); activity.onBackPressed(); listener.onReady();
                    check(!activity.isFinishing() && ((View) get(activity, "status")).getVisibility() == View.VISIBLE && prefs(activity).getString("last", "").equals(B), "Back during cyclic loading left the foreground or saved a cancelled endpoint");
                    swipeCommand(activity, -1); listener.onReady();
                    check(prefs(activity).getString("last", "").equals(B), "Cancelled cycle could not be swiped again");
                    seed(activity, saved, A); web.deferred = true; activity.onBackPressed(); delayed = web.pendingBack; count = web.connections.size();
                    test.callActivityOnPause(activity); delayed.onReceiveValue("false");
                    check(web.connections.size() == count && !(Boolean) get(activity, "backPending"), "Delayed Back navigated after pause");
                    test.callActivityOnResume(activity); web.deferred = false;
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
    private static void tapPageButton(Instrumentation test, AxiomWebView web) throws Exception {
        org.json.JSONArray rectangle = new org.json.JSONArray(javascript(test, web, "(()=>{const r=document.querySelector('#page-next').getBoundingClientRect();return [r.left+r.width/2,r.top+r.height/2,innerWidth]})()"));
        float x = (float) rectangle.getDouble(0), y = (float) rectangle.getDouble(1), width = (float) rectangle.getDouble(2);
        float[] point = new float[2];
        test.runOnMainSync(() -> {
            int[] location = new int[2]; web.getLocationOnScreen(location); web.requestFocus();
            float scale = web.getWidth() / width;
            point[0] = location[0] + x * scale; point[1] = location[1] + y * scale;
        });
        long time = android.os.SystemClock.uptimeMillis();
        android.view.MotionEvent down = android.view.MotionEvent.obtain(time, time, android.view.MotionEvent.ACTION_DOWN, point[0], point[1], 0);
        android.view.MotionEvent up = android.view.MotionEvent.obtain(time, time + 40, android.view.MotionEvent.ACTION_UP, point[0], point[1], 0);
        try { test.sendPointerSync(down); test.sendPointerSync(up); } finally { down.recycle(); up.recycle(); }
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
            result.set("url=" + web.getUrl() + ", index=" + list.getCurrentIndex() + ", canGoBack=" + web.canGoBack() + ", history=" + urls + ", last=" + prefs(activity).getString("last", ""));
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
                        String before = navigation(test, activity, web);
                        try {
                            // A trusted tap models actual SPA navigation; unactivated script entries can be skipped by Chromium.
                            tapPageButton(test, web);
                            waitFor(() -> "true".equals(javascript(test, web, "location.origin === '" + b + "' && location.pathname === '/secondary' && navigator.userActivation.hasBeenActive")) && nativeHistory(test, web, b, "/secondary", 1, 2), "Second workstation pushState did not reach native history");
                            test.sendKeyDownUpSync(KeyEvent.KEYCODE_BACK);
                            waitFor(() -> "true".equals(javascript(test, web, "location.origin === '" + b + "' && location.pathname === '/'")), "Second workstation page history was skipped");
                            check(prefs(activity).getString("last", "").equals(b), "Second workstation page Back switched connections");
                            ready(test, activity, b);
                            waitFor(() -> nativeHistory(test, web, b, "/", 0, 2), "Second workstation Back did not settle at root");
                            check("true".equals(javascript(test, web, "location.origin === '" + b + "' && location.pathname === '/'")) && prefs(activity).getString("last", "").equals(b), "Second workstation Back did not remain on the same computer");
                            check(prefs(activity).getString("history", "").equals(saved), "Page Back reordered saved connections");
                        } catch (AssertionError failure) {
                            throw new AssertionError(failure.getMessage() + "; before: " + before + "; after: " + navigation(test, activity, web) + "; renderer=" + javascript(test, web, "[location.href,history.length,navigator.userActivation.hasBeenActive]"), failure);
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
    private static void swipeTouch(Instrumentation test, View view, boolean left, float yFraction) throws Exception {
        float[] points = new float[5];
        test.runOnMainSync(() -> {
            int[] location = new int[2]; view.getLocationOnScreen(location);
            points[0] = location[0] + view.getWidth() * (left ? .78f : .22f);
            points[1] = location[1] + view.getHeight() * yFraction;
            points[2] = view.getWidth() * (left ? -.56f : .56f);
        });
        long start = android.os.SystemClock.uptimeMillis();
        android.view.MotionEvent event = android.view.MotionEvent.obtain(start, start, android.view.MotionEvent.ACTION_DOWN, points[0], points[1], 0);
        try { test.sendPointerSync(event); } finally { event.recycle(); }
        for (int step = 1; step <= 12; step++) {
            android.os.SystemClock.sleep(16);
            event = android.view.MotionEvent.obtain(start, android.os.SystemClock.uptimeMillis(), android.view.MotionEvent.ACTION_MOVE, points[0] + points[2] * step / 12, points[1], 0);
            try { test.sendPointerSync(event); } finally { event.recycle(); }
        }
        event = android.view.MotionEvent.obtain(start, android.os.SystemClock.uptimeMillis(), android.view.MotionEvent.ACTION_UP, points[0] + points[2], points[1], 0);
        try { test.sendPointerSync(event); } finally { event.recycle(); }
        test.waitForIdleSync();
    }
    private static void contentSwipe(Instrumentation test, AxiomWebView web, boolean left) throws Exception {
        waitFor(() -> "true".equals(javascript(test, web, "Boolean(window.__axiomConnectionSwipeCleanup && window.fixtureSwipePort)")), "Swipe port was not installed");
        org.json.JSONArray point = new org.json.JSONArray(javascript(test, web, "(()=>{const s=document.querySelector('#swipe-surface'),r=s.getBoundingClientRect(),y=r.top+r.height/2;return [y/innerHeight,[.22,.5,.78].every(x=>document.elementFromPoint(innerWidth*x,y)===s)]})()"));
        check(point.getBoolean(1), "Fixture swipe surface was obscured");
        swipeTouch(test, web, left, (float) point.getDouble(0));
    }
    private static void statusSwipe(Instrumentation test, MainActivity activity, boolean left) throws Exception {
        View root = (View) get(activity, "root"); float[] fraction = new float[1];
        test.runOnMainSync(() -> { try {
            android.graphics.Rect addressBounds = new android.graphics.Rect();
            ((View) get(activity, "address")).getGlobalVisibleRect(addressBounds);
            int[] location = new int[2]; root.getLocationOnScreen(location);
            for (float candidate : new float[]{.12f, .5f, .88f}) {
                int x = location[0] + Math.round(root.getWidth() * (left ? .78f : .22f));
                int y = location[1] + Math.round(root.getHeight() * candidate);
                if (!addressBounds.contains(x, y)) { fraction[0] = candidate; return; }
            }
            throw new AssertionError("No status swipe surface outside address editing");
        } catch (Exception error) { throw new AssertionError(error); } });
        swipeTouch(test, root, left, fraction[0]);
    }
    private static void recoverableFailure(Instrumentation test, MainActivity activity, String last) throws Exception {
        waitFor(() -> { AtomicReference<Boolean> failed = new AtomicReference<>(false); test.runOnMainSync(() -> { try { failed.set(!(Boolean) get(activity, "connecting") && ((View) get(activity, "status")).getVisibility() == View.VISIBLE); } catch (Exception error) { throw new AssertionError(error); } }); return failed.get(); }, "Failed swipe did not show recoverable status");
        check(!activity.isFinishing() && prefs(activity).getString("last", "").equals(last), "Failed swipe exited or saved an unready endpoint");
    }
    private static void stableOrigin(Instrumentation test, MainActivity activity, AxiomWebView web, String endpoint) throws Exception {
        for (int i = 0; i < 10; i++) {
            android.os.SystemClock.sleep(50);
            check("true".equals(javascript(test, web, "location.origin === '" + endpoint + "'")) && prefs(activity).getString("last", "").equals(endpoint), "Late swipe response replaced the final workstation");
        }
    }
    static void realSwipe(Instrumentation test) throws Exception {
        try (Workstation first = new Workstation(); Workstation second = new Workstation(); Workstation third = new Workstation(); Workstation delayed = new Workstation(); Workstation reverseDelayed = new Workstation(); Workstation failing = new Workstation()) {
            MainActivity activity = start(test); AxiomWebView web = (AxiomWebView) get(activity, "web");
            String a = first.endpoint(), b = second.endpoint(), c = third.endpoint(), saved = String.join("\n", a, b, c);
            try {
                test.runOnMainSync(() -> { try {
                    prefs(activity).edit().putString("history", saved).putString("last", a).commit();
                    ((TextView) get(activity, "address")).setText(a); ((View) get(activity, "retry")).performClick();
                } catch (Exception error) { throw new AssertionError(error); } });
                rootReady(test, activity, web, a);
                test.runOnMainSync(() -> {
                    web.requestFocus();
                    ((android.view.inputmethod.InputMethodManager) activity.getSystemService(android.content.Context.INPUT_METHOD_SERVICE)).hideSoftInputFromWindow(web.getWindowToken(), 0);
                });
                test.waitForIdleSync();
                for (boolean left : new boolean[]{true, false}) for (String expected : left ? new String[]{b, c, a, b, c, a} : new String[]{c, b, a, c, b, a}) {
                    contentSwipe(test, web, left); rootReady(test, activity, web, expected);
                    check(!activity.isFinishing() && prefs(activity).getString("history", "").equals(saved), "Touch cycle left the app or reordered the ring");
                }
                // A connection gesture bypasses page Back, rather than consuming it.
                tapPageButton(test, web);
                waitFor(() -> nativeHistory(test, web, a, "/secondary", 1, 2), "Swipe fixture did not acquire page history");
                contentSwipe(test, web, true); rootReady(test, activity, web, b);
                // Same-origin full-document navigation must install a new working port.
                test.runOnMainSync(() -> web.loadUrl(b + "/nested"));
                waitFor(() -> nativeHistory(test, web, b, "/nested", 1, 2), "Nested swipe document did not load");
                contentSwipe(test, web, false); rootReady(test, activity, web, a);
                contentSwipe(test, web, true); rootReady(test, activity, web, b);
                // The DOM-aware recognizer must leave code/table horizontal scrolling alone.
                float scrollY = Float.parseFloat(javascript(test, web, "(()=>{const r=document.querySelector('#horizontal-scroll').getBoundingClientRect();return (r.top+r.height/2)/innerHeight})()"));
                swipeTouch(test, web, true, scrollY);
                waitFor(() -> "true".equals(javascript(test, web, "document.querySelector('#horizontal-scroll').scrollLeft > 0")), "Horizontal content did not scroll");
                check(prefs(activity).getString("last", "").equals(b), "Horizontal code scroll switched connections");
                // Rapid touch on the native loading page supersedes the blocked target.
                delayed.blockStatus();
                test.runOnMainSync(() -> prefs(activity).edit().putString("history", String.join("\n", b, delayed.endpoint(), c)).commit());
                contentSwipe(test, web, true);
                check(delayed.requested.await(5, TimeUnit.SECONDS), "Swipe did not start the delayed workstation");
                javascript(test, web, "window.fixtureSwipePort.postMessage('previous')");
                android.os.SystemClock.sleep(200); test.waitForIdleSync();
                test.runOnMainSync(() -> { try { check((Boolean) get(activity, "connecting") && get(activity, "connectingAddress").equals(delayed.endpoint()) && prefs(activity).getString("last", "").equals(b), "Retired document port advanced a pending connection"); } catch (Exception error) { throw new AssertionError(error); } });
                statusSwipe(test, activity, true); rootReady(test, activity, web, c);
                delayed.release.countDown(); check(delayed.replied.await(5, TimeUnit.SECONDS), "Cancelled swipe response never completed");
                stableOrigin(test, activity, web, c);
                // The native loading page must also preserve reverse direction.
                reverseDelayed.blockStatus();
                test.runOnMainSync(() -> prefs(activity).edit().putString("history", String.join("\n", b, reverseDelayed.endpoint(), c)).commit());
                contentSwipe(test, web, false);
                check(reverseDelayed.requested.await(5, TimeUnit.SECONDS), "Reverse swipe did not start the delayed workstation");
                statusSwipe(test, activity, false); rootReady(test, activity, web, b);
                reverseDelayed.release.countDown(); check(reverseDelayed.replied.await(5, TimeUnit.SECONDS), "Cancelled reverse swipe response never completed");
                stableOrigin(test, activity, web, b);
                // Failed probing leaves both directions available, without saving it.
                failing.failStatus(); String failedRing = String.join("\n", b, failing.endpoint(), a);
                test.runOnMainSync(() -> prefs(activity).edit().putString("history", failedRing).commit());
                contentSwipe(test, web, true); recoverableFailure(test, activity, b);
                View address = (View) get(activity, "address");
                test.runOnMainSync(() -> address.requestRectangleOnScreen(new android.graphics.Rect(0, 0, address.getWidth(), address.getHeight()), true));
                test.waitForIdleSync(); swipeTouch(test, address, true, .5f);
                recoverableFailure(test, activity, b);
                check(get(activity, "connectingAddress").equals(failing.endpoint()), "Address editing drag switched connections");
                test.runOnMainSync(() -> {
                    ((android.widget.AutoCompleteTextView) address).dismissDropDown(); address.clearFocus();
                    ((android.view.inputmethod.InputMethodManager) activity.getSystemService(android.content.Context.INPUT_METHOD_SERVICE)).hideSoftInputFromWindow(address.getWindowToken(), 0);
                });
                test.waitForIdleSync(); statusSwipe(test, activity, false); rootReady(test, activity, web, b);
                contentSwipe(test, web, true); recoverableFailure(test, activity, b);
                statusSwipe(test, activity, true); rootReady(test, activity, web, a);
                check(prefs(activity).getString("history", "").equals(failedRing), "Recovery swipe reordered the history");
                // A ready status probe followed by a failed main document, and a
                // refused TCP connection, exercise different real SDK error paths.
                failing.failDocument();
                String refused;
                try (ServerSocket unused = new ServerSocket(0, 1, InetAddress.getByName("127.0.0.1"))) { refused = "http://127.0.0.1:" + unused.getLocalPort(); }
                for (String unavailable : new String[]{failing.endpoint(), refused}) {
                    String errorRing = String.join("\n", a, unavailable, c);
                    test.runOnMainSync(() -> prefs(activity).edit().putString("history", errorRing).commit());
                    contentSwipe(test, web, true); recoverableFailure(test, activity, a);
                    statusSwipe(test, activity, false); rootReady(test, activity, web, a);
                    check(prefs(activity).getString("history", "").equals(errorRing), "Network error recovery reordered the history");
                }
            } finally { test.runOnMainSync(activity::finish); test.waitForIdleSync(); }
        }
    }
    /** Independent HTTP origins, real WebView load/readiness, no model or external networking. */
    private static final class Workstation implements AutoCloseable {
        private final ServerSocket server;
        private final ExecutorService worker = Executors.newSingleThreadExecutor();
        final CountDownLatch requested = new CountDownLatch(1), replied = new CountDownLatch(1), release = new CountDownLatch(1);
        private volatile boolean blocked;
        private volatile int statusCode = 200, documentCode = 200;
        void blockStatus() { blocked = true; }
        void failStatus() { statusCode = 503; }
        void failDocument() { statusCode = 200; documentCode = 503; }
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
                    String html = "<!doctype html><meta name='viewport' content='width=device-width,initial-scale=1'><script>addEventListener('message',e=>{if(e.ports.length===1)window.fixtureSwipePort=e.ports[0]})</script><div id='app'><span class='connection-status' data-connected='true'>Fixture ready</span></div><div id='horizontal-scroll' style='position:fixed;left:16px;top:35%;width:calc(100% - 32px);height:20%;overflow-x:auto;user-select:none'><div style='width:4000px;height:40px'>Horizontal code content</div></div><div id='popover' popover>Menu</div><dialog>Details</dialog><button id='collapse-history' onclick=\"document.body.classList.remove('history-open')\">Close history</button><button id='page-next' style='position:fixed;left:16px;top:10%;width:200px;height:52px' onclick=\"history.pushState(null, '', '/secondary')\">Open secondary page</button><div id='swipe-surface' style='position:fixed;left:0;top:65%;width:100%;height:30%'></div>";
                    byte[] body = (status ? "{\"connected\":true}" : html).getBytes(StandardCharsets.UTF_8);
                    OutputStream out = socket.getOutputStream();
                    out.write(("HTTP/1.1 " + (status ? statusCode : documentCode) + " Fixture\r\nContent-Type: " + (status ? "application/json" : "text/html; charset=utf-8") + "\r\nContent-Length: " + body.length + "\r\nConnection: close\r\n\r\n").getBytes(StandardCharsets.UTF_8));
                    out.write(body); out.flush();
                } catch (IOException ignored) { /* Closing the fixture or a cancelled request is expected. */ }
                finally { if (blocked) replied.countDown(); }
            });
        }
        String endpoint() { return "http://127.0.0.1:" + server.getLocalPort(); }
        public void close() throws IOException { release.countDown(); server.close(); worker.shutdownNow(); }
    }
}
