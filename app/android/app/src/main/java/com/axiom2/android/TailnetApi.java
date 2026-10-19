package com.axiom2.android;

import org.json.JSONArray;
import org.json.JSONObject;
import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.*;

/** Read-only cloud inventory. VPN routing and final WebSocket readiness remain separate. */
final class TailnetApi implements AutoCloseable {
    static final String API = "https://api.tailscale.com/api/v2";
    static final int MAX_DEVICES = 1000;
    static final class Credentials {
        final String tailnet, clientId, secret;
        final int port;
        Credentials(String tailnet, String clientId, String secret, int port) throws IOException {
            this.tailnet = tailnet.trim().isEmpty() ? "-" : tailnet.trim();
            this.clientId = clientId.trim(); this.secret = secret.trim(); this.port = port;
            if (!this.tailnet.matches("[-a-zA-Z0-9._@]{1,254}")) throw new IOException("Tailnet 名称无效，请填写管理页中的名称，或使用 -。");
            if (!safeCredential(this.clientId) || !safeCredential(this.secret)) throw new IOException("请填写有效的 Client ID 和 Client secret。");
            if (port < 1 || port > 65535) throw new IOException("服务端口应为 1–65535。");
        }
        private static boolean safeCredential(String value) {
            if (value.isEmpty() || value.length() > 4096) return false;
            for (int i = 0; i < value.length(); i++) if (Character.isISOControl(value.charAt(i))) return false;
            return true;
        }
    }
    static final class Device {
        final String id, name;
        final List<String> addresses;
        final Boolean connectedToControl;
        Device(String id, String name, List<String> addresses, Boolean connectedToControl) {
            this.id = id; this.name = name; this.addresses = Collections.unmodifiableList(addresses); this.connectedToControl = connectedToControl;
        }
        String endpoint(String ip, int port) { return "http://" + (ip.contains(":") ? "[" + ip + "]" : ip) + ":" + port; }
    }
    static final class Probe {
        final String endpoint, label;
        final boolean reachable;
        Probe(String endpoint, String label, boolean reachable) { this.endpoint = endpoint; this.label = label; this.reachable = reachable; }
    }
    static final class Cancel {
        private boolean cancelled;
        private final Set<HttpURLConnection> connections = new HashSet<>();
        synchronized void check() throws InterruptedIOException {
            if (cancelled || Thread.currentThread().isInterrupted()) throw new InterruptedIOException("操作已取消。");
        }
        synchronized void attach(HttpURLConnection connection) throws IOException { check(); connections.add(connection); }
        synchronized void detach(HttpURLConnection connection) { connections.remove(connection); }
        void cancel() {
            List<HttpURLConnection> copy;
            synchronized (this) { cancelled = true; copy = new ArrayList<>(connections); connections.clear(); }
            for (HttpURLConnection connection : copy) connection.disconnect();
        }
    }
    static final class Reply {
        final int code; final String body;
        Reply(int code, String body) { this.code = code; this.body = body; }
    }
    interface Transport {
        Reply request(String url, String bearer, String form, int limit, int timeoutMs, Cancel cancel) throws IOException;
    }
    private final ScheduledExecutorService deadlines;
    private final Transport transport;
    TailnetApi() {
        deadlines = Executors.newScheduledThreadPool(2);
        transport = this::request;
    }
    // Tests supply a fake transport; production endpoints cannot be configured by a user or a WebView.
    TailnetApi(Transport transport) { this.transport = transport; deadlines = null; }
    private Reply request(String address, String bearer, String form, int limit, int timeoutMs, Cancel cancel) throws IOException {
        cancel.check();
        HttpURLConnection connection = (HttpURLConnection) new URL(address).openConnection(Proxy.NO_PROXY);
        connection.setConnectTimeout(timeoutMs); connection.setReadTimeout(timeoutMs);
        connection.setInstanceFollowRedirects(false); connection.setUseCaches(false);
        connection.setRequestProperty("Accept", "application/json");
        connection.setRequestProperty("Accept-Encoding", "identity");
        if (bearer != null) connection.setRequestProperty("Authorization", "Bearer " + bearer);
        connection.setRequestMethod(form == null ? "GET" : "POST");
        cancel.attach(connection);
        ScheduledFuture<?> deadline = deadlines.schedule(connection::disconnect, timeoutMs, TimeUnit.MILLISECONDS);
        long until = System.nanoTime() + TimeUnit.MILLISECONDS.toNanos(timeoutMs);
        try {
            if (form != null) {
                byte[] body = form.getBytes(StandardCharsets.UTF_8);
                connection.setDoOutput(true); connection.setFixedLengthStreamingMode(body.length);
                connection.setRequestProperty("Content-Type", "application/x-www-form-urlencoded");
                try (OutputStream output = connection.getOutputStream()) { output.write(body); }
            }
            int code = connection.getResponseCode();
            // Never surface or log upstream error bodies, which may echo authentication material.
            if (code != 200) return new Reply(code, "");
            if (connection.getContentLengthLong() > limit) throw new IOException("响应过大，请缩小设备范围后重试。");
            ByteArrayOutputStream output = new ByteArrayOutputStream();
            try (InputStream input = connection.getInputStream()) {
                byte[] buffer = new byte[4096]; int count;
                while ((count = input.read(buffer)) != -1) {
                    cancel.check();
                    if (System.nanoTime() > until) throw new SocketTimeoutException();
                    if (output.size() + count > limit) throw new IOException("响应过大，请缩小设备范围后重试。");
                    output.write(buffer, 0, count);
                }
            }
            cancel.check(); return new Reply(code, output.toString("UTF-8"));
        } finally { deadline.cancel(false); cancel.detach(connection); connection.disconnect(); }
    }
    List<Device> devices(Credentials credentials, Cancel cancel) throws IOException {
        String form = "grant_type=client_credentials&client_id=" + encode(credentials.clientId)
                + "&client_secret=" + encode(credentials.secret) + "&scope=devices%3Acore%3Aread";
        Reply auth = transport.request(API + "/oauth/token", null, form, 16384, 8000, cancel);
        requireSuccess(auth.code, true);
        String token;
        try {
            JSONObject body = new JSONObject(auth.body);
            token = body.getString("access_token");
            if (token.isEmpty() || token.length() > 8192 || !token.matches("[A-Za-z0-9._~+/-]+=*")) throw new Exception();
            if (!"bearer".equalsIgnoreCase(body.optString("token_type", "Bearer"))) throw new Exception();
        } catch (Exception e) { throw new IOException("Tailscale 授权响应无效，请重试。"); }
        cancel.check();
        Reply result = transport.request(API + "/tailnet/" + encode(credentials.tailnet) + "/devices?fields=all", token, null, 2 * 1024 * 1024, 10000, cancel);
        requireSuccess(result.code, false); cancel.check();
        return parseDevices(result.body);
    }
    private static String encode(String value) throws IOException { return URLEncoder.encode(value, "UTF-8"); }
    private static void requireSuccess(int code, boolean auth) throws IOException {
        if (code == 200) return;
        if (code == 400 || code == 401 || code == 403) throw new IOException(auth
                ? "Tailscale 授权失败。请核对 Client ID、secret 及 devices:core:read 权限。"
                : "无权读取此 Tailnet。请核对 Tailnet 名称、凭据及 devices:core:read 权限。");
        if (code == 404) throw new IOException("未找到 Tailnet，请核对名称或使用 -。");
        if (code == 429) throw new IOException("Tailscale 请求过于频繁，请稍后刷新。");
        throw new IOException("Tailscale 服务暂时不可用（HTTP " + code + "），请稍后刷新。");
    }
    static List<Device> parseDevices(String text) throws IOException {
        try {
            JSONArray rows = new JSONObject(text).getJSONArray("devices");
            if (rows.length() > MAX_DEVICES) throw new IOException("设备数超过 1,000，暂不支持加载此设备清单。");
            List<Device> result = new ArrayList<>(); Set<String> ids = new HashSet<>();
            for (int i = 0; i < rows.length(); i++) {
                JSONObject row = rows.getJSONObject(i);
                String id = row.getString("id");
                if (id.isEmpty() || !ids.add(id)) throw new IOException("Tailscale 设备响应无效，请重试。");
                JSONArray raw = row.getJSONArray("addresses"); List<String> ips = new ArrayList<>();
                if (raw.length() > 16) throw new IOException("Tailscale 设备地址响应无效，请重试。");
                for (int j = 0; j < raw.length(); j++) {
                    String ip = raw.getString(j);
                    // One address per family bounds each device to two probes; no subnet or hostname scanning.
                    boolean familyPresent = false;
                    for (String chosen : ips) if (chosen.contains(":") == ip.contains(":")) familyPresent = true;
                    if (isTailnetIp(ip) && !familyPresent) ips.add(ip);
                }
                ips.sort((a, b) -> Boolean.compare(a.contains(":"), b.contains(":")));
                String name = row.optString("hostname", "");
                if (name.trim().isEmpty()) name = row.optString("name", "未命名设备");
                name = name.replaceAll("[\\p{Cntrl}\\u202a-\\u202e\\u2066-\\u2069]", "");
                if (name.length() > 200) name = name.substring(0, 200);
                Object online = row.opt("connectedToControl");
                result.add(new Device(id, name, ips, online instanceof Boolean ? (Boolean) online : null));
            }
            result.sort((a, b) -> a.name.compareToIgnoreCase(b.name));
            return result;
        } catch (IOException e) { throw e; }
        catch (Exception e) { throw new IOException("Tailscale 设备响应无效，请重试。"); }
    }
    static boolean isTailnetIp(String ip) {
        try {
            if (ip.matches("100\\.[0-9]{1,3}\\.[0-9]{1,3}\\.[0-9]{1,3}")) {
                String[] parts = ip.split("\\.");
                for (String part : parts) if (Integer.parseInt(part) > 255 || (part.length() > 1 && part.startsWith("0"))) return false;
                int second = Integer.parseInt(parts[1]); return second >= 64 && second <= 127;
            }
            if (!ip.contains(":") || !ip.matches("[0-9a-fA-F:]+")) return false;
            byte[] bytes = InetAddress.getByName(ip).getAddress();
            return bytes.length == 16 && (bytes[0] & 255) == 0xfd && (bytes[1] & 255) == 0x7a
                    && (bytes[2] & 255) == 0x11 && (bytes[3] & 255) == 0x5c && (bytes[4] & 255) == 0xa1 && (bytes[5] & 255) == 0xe0;
        } catch (Exception e) { return false; }
    }
    Probe probe(Device device, int port, Cancel cancel) throws IOException {
        String fallback = device.addresses.isEmpty() ? "" : device.endpoint(device.addresses.get(0), port);
        for (String ip : device.addresses) {
            cancel.check();
            try {
                String endpoint = device.endpoint(ip, port);
                Reply reply = transport.request(endpoint + "/api/status", null, null, 8192, 2500, cancel);
                if (reply.code == 200 && Boolean.TRUE.equals(new JSONObject(reply.body).opt("connected")))
                    return new Probe(endpoint, "服务可达", true);
            } catch (Exception ignored) { cancel.check(); }
        }
        return new Probe(fallback, fallback.isEmpty() ? "没有可用的 Tailscale IP" : "暂不可达 · 请检查 VPN、服务与端口", false);
    }
    static String failure(Exception error) {
        if (error instanceof SocketTimeoutException || error instanceof InterruptedIOException) return "请求超时或已取消，请检查网络后刷新。";
        if (error instanceof UnknownHostException || error instanceof ConnectException || error instanceof NoRouteToHostException)
            return "无法访问 Tailscale API，请检查手机网络后刷新。";
        // Only messages constructed here are allowed out; TLS/platform errors may contain URLs or secrets.
        String message = error.getMessage();
        if (error.getClass() == IOException.class && message != null && (message.startsWith("Tailscale ") || message.startsWith("无权读取") || message.startsWith("未找到 Tailnet") || message.startsWith("设备数超过") || message.startsWith("响应过大"))) return message;
        return "设备列表加载失败，请检查网络与只读凭据后重试。";
    }
    @Override public void close() { if (deadlines != null) deadlines.shutdownNow(); }
}
