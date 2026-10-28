package com.axiom2.android;

import android.content.Context;
import android.net.Uri;
import android.webkit.WebMessage;
import android.webkit.WebMessagePort;
import com.axiom.sdk.AxiomWebView;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.function.IntConsumer;
import java.util.UUID;

/** A document-scoped, origin-restricted port; no interface is exposed to iframes. */
final class ConnectionSwipeBridge {
    private final String script;
    private final IntConsumer swipe;
    private WebMessagePort port;
    private int generation;

    ConnectionSwipeBridge(Context context, IntConsumer swipe) {
        this.swipe = swipe;
        try (InputStream input = context.getAssets().open("connection-swipe.js"); ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[4096]; int size;
            while ((size = input.read(buffer)) != -1) output.write(buffer, 0, size);
            script = new String(output.toByteArray(), StandardCharsets.UTF_8);
        } catch (Exception error) { throw new IllegalStateException("Connection gesture asset is missing", error); }
    }
    void install(AxiomWebView web) {
        close();
        if (!web.isAttachedToWindow()) return;
        Uri current = Uri.parse(web.getUrl() == null ? "" : web.getUrl());
        if (!("http".equals(current.getScheme()) || "https".equals(current.getScheme())) || current.getAuthority() == null) return;
        Uri origin = current.buildUpon().path(null).query(null).fragment(null).build();
        int owned = generation;
        String handshake = "axiom-connection-swipe:" + UUID.randomUUID();
        web.evaluateJavascript(script.replace("__AXIOM_CONNECTION_SWIPE_HANDSHAKE__", handshake), ignored -> {
            if (owned != generation || !web.isAttachedToWindow()) return;
            WebMessagePort[] channel = web.createWebMessageChannel();
            port = channel[0];
            port.setWebMessageCallback(new WebMessagePort.WebMessageCallback() {
                @Override public void onMessage(WebMessagePort source, WebMessage message) {
                    if (owned != generation || source != port) return;
                    if ("next".equals(message.getData())) swipe.accept(1);
                    else if ("previous".equals(message.getData())) swipe.accept(-1);
                }
            });
            web.postWebMessage(new WebMessage(handshake, new WebMessagePort[]{channel[1]}), origin);
        });
    }
    void close() {
        generation++;
        if (port != null) { port.close(); port = null; }
    }
}
