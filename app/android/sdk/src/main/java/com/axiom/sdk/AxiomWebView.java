package com.axiom.sdk;

import android.annotation.SuppressLint;
import android.content.Context;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import android.webkit.*;
import android.net.http.SslError;
import org.json.JSONObject;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;

/** Same-origin Axiom client. Tailscale's Android VPN supplies the private-network route. */
public class AxiomWebView extends WebView {
    public interface Listener {
        void onReady(); void onError(String message); void onExternalLink(Uri uri);
        /** Main-document navigation, including pages opened after initial readiness. */
        default void onDocumentLoading() {}
        default void onDocumentLoaded() {}
        /** The owner must remove, destroy and replace this WebView after this callback. */
        default void onRendererGone() { onError("页面进程已退出，请重新创建工作台。"); }
    }
    private final ExecutorService executor = Executors.newCachedThreadPool();
    private final Handler main = new Handler(Looper.getMainLooper());
    private volatile int generation;
    private volatile boolean disposed;
    private volatile HttpURLConnection activeRequest;
    private Future<?> pending;
    private String origin = "";
    private Listener listener;
    @SuppressLint("SetJavaScriptEnabled")
    public AxiomWebView(Context context) {
        super(context); setBackgroundColor(0xff08090a);
        getSettings().setJavaScriptEnabled(true); getSettings().setDomStorageEnabled(true);
        getSettings().setAllowFileAccess(false); getSettings().setAllowContentAccess(true);
        getSettings().setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        getSettings().setBuiltInZoomControls(false); getSettings().setMediaPlaybackRequiresUserGesture(true);
        CookieManager.getInstance().setAcceptCookie(true); CookieManager.getInstance().setAcceptThirdPartyCookies(this, false);
    }
    public void setListener(Listener value) { listener = value; }
    public static String normalizeAddress(String address) throws Exception {
        String value = address.trim(); if (!value.contains("://")) value = "http://" + value;
        URL url = new URL(value);
        if (!(url.getProtocol().equals("http") || url.getProtocol().equals("https")) || url.getHost().isEmpty() || url.getUserInfo() != null || url.getQuery() != null || url.getRef() != null || !(url.getPath().isEmpty() || url.getPath().equals("/"))) throw new Exception("请输入连接地址，例如 http://100.x.x.x:4317，不要包含路径。");
        if (url.getPort() == 0 || url.getPort() > 65535) throw new Exception("端口应为 1–65535。");
        return url.getProtocol() + "://" + url.getAuthority() + (url.getPort() < 0 ? ":4317" : "");
    }
    private boolean sameOrigin(String value) {
        try { URL a = new URL(origin), b = new URL(value); return a.getProtocol().equals(b.getProtocol()) && a.getHost().equalsIgnoreCase(b.getHost()) && a.getPort() == b.getPort(); } catch (Exception e) { return false; }
    }
    private boolean owns(int owned) { return !disposed && generation == owned; }
    private void fail(int owned, String message) { main.post(() -> { if (owns(owned) && listener != null) listener.onError(message); }); }
    private void mount(int owned, String endpoint) {
        if (!owns(owned)) return;
        origin = endpoint;
        final String navigation = endpoint + "/#axiom-native=" + owned;
        final boolean[] awaiting = { true };
        final Runnable deadline = () -> {
            if (owns(owned) && awaiting[0]) { awaiting[0] = false; stopLoading(); fail(owned, "工作台加载超时。请检查网络与电脑服务，然后重试。"); }
        };
        main.postDelayed(deadline, 25000);
        setWebViewClient(new WebViewClient() {
            private boolean failed, ready;
            private void pageError(String message) { if (owns(owned) && !failed) { failed = true; awaiting[0] = false; main.removeCallbacks(deadline); fail(owned, message); } }
            private void checkReady(int attempt) {
                if (!owns(owned) || failed || ready || !awaiting[0]) return;
                evaluateJavascript("Boolean(document.querySelector('#app .connection-status[data-connected=true]'))", result -> {
                    if (!owns(owned) || failed || ready || !awaiting[0]) return;
                    if ("true".equals(result)) { ready = true; awaiting[0] = false; main.removeCallbacks(deadline); if (listener != null) listener.onReady(); }
                    else if (attempt >= 60) pageError("工作台未能完成加载。请更新 Android System WebView，并确认电脑端服务已更新后重试。");
                    else main.postDelayed(() -> checkReady(attempt + 1), 250);
                });
            }
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl(); if (!owns(owned)) return true;
                if (sameOrigin(uri.toString())) return false;
                if (listener != null && ("https".equals(uri.getScheme()) || "http".equals(uri.getScheme()))) listener.onExternalLink(uri);
                return true;
            }
            @Override public void onPageStarted(WebView view, String url, android.graphics.Bitmap icon) {
                if (owns(owned) && sameOrigin(url) && listener != null) listener.onDocumentLoading();
            }
            @Override public void onPageFinished(WebView view, String url) {
                if (!owns(owned) || failed || !sameOrigin(url)) return;
                if (listener != null) listener.onDocumentLoaded();
                if (navigation.equals(url)) checkReady(0);
            }
            @Override public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (request.isForMainFrame() && sameOrigin(request.getUrl().toString())) pageError("页面暂时无法打开。请确认 Tailscale 已连接、电脑后台仍在运行，然后重试。");
            }
            @Override public void onReceivedHttpError(WebView view, WebResourceRequest request, WebResourceResponse response) {
                if (request.isForMainFrame() && sameOrigin(request.getUrl().toString())) pageError("服务返回 HTTP " + response.getStatusCode() + "，请确认电脑后台运行后重试。");
            }
            @Override public void onReceivedSslError(WebView view, SslErrorHandler handler, SslError error) { handler.cancel(); if (sameOrigin(error.getUrl())) pageError("连接证书无法验证，请检查服务器地址和设备时间。"); }
            // Renderer loss belongs to the WebView instance, even while an old
            // client's connection generation has been superseded by a new probe.
            @Override public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) { if (!disposed && listener != null) listener.onRendererGone(); return true; }
        });
        loadUrl(navigation);
    }
    private HttpURLConnection request(String url, int owned) throws Exception {
        if (!owns(owned) || Thread.currentThread().isInterrupted()) throw new InterruptedException();
        HttpURLConnection connection = (HttpURLConnection) new URL(url).openConnection();
        connection.setConnectTimeout(10000); connection.setReadTimeout(12000); connection.setInstanceFollowRedirects(false);
        connection.setRequestMethod("GET");
        synchronized (this) { if (!owns(owned)) { connection.disconnect(); throw new InterruptedException(); } activeRequest = connection; }
        return connection;
    }
    public void connect(String address) {
        cancelConnect(); final int owned = generation;
        final String endpoint;
        try { endpoint = normalizeAddress(address); } catch (Exception e) { fail(owned, e.getMessage()); return; }
        pending = executor.submit(() -> {
            HttpURLConnection connection = null;
            try {
                connection = request(endpoint + "/api/status", owned);
                if (connection.getResponseCode() != 200) throw new Exception("后台尚未就绪，请稍后重试。");
                java.io.ByteArrayOutputStream output = new java.io.ByteArrayOutputStream(); byte[] bytes = new byte[1024]; int count;
                try (java.io.InputStream input = connection.getInputStream()) { while ((count = input.read(bytes)) != -1) { if (!owns(owned)) throw new InterruptedException(); if (output.size() + count > 8192) throw new Exception("服务器响应无效，请检查地址。"); output.write(bytes, 0, count); } }
                if (!new JSONObject(output.toString("UTF-8")).optBoolean("connected")) throw new Exception("后台未确认就绪。");
                main.post(() -> mount(owned, endpoint));
            } catch (Exception e) {
                if (e instanceof InterruptedException) return;
                String message = e instanceof java.net.SocketTimeoutException ? "连接超时。请确认两台设备的 Tailscale 均在线，电脑未休眠，并允许 Tailscale 网络访问 4317 端口。" : e instanceof java.net.ConnectException || e instanceof java.net.UnknownHostException || e instanceof java.net.NoRouteToHostException ? "暂时无法到达电脑。请连接 Tailscale，并核对电脑显示的内网地址。" : e.getMessage();
                fail(owned, message == null ? "连接未完成，请重试。" : message);
            } finally { if (connection != null) { connection.disconnect(); synchronized (this) { if (activeRequest == connection) activeRequest = null; } } }
        });
    }
    public void cancelConnect() {
        generation++; main.removeCallbacksAndMessages(null); if (pending != null) pending.cancel(true);
        synchronized (this) { if (activeRequest != null) { activeRequest.disconnect(); activeRequest = null; } }
        stopLoading();
    }
    @Override public void onResume() { super.onResume(); evaluateJavascript("window.dispatchEvent(new Event('online'));window.dispatchEvent(new Event('focus'));", null); }
    @Override public void destroy() { cancelConnect(); disposed = true; executor.shutdownNow(); listener = null; super.destroy(); }
}
