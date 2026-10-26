import { createServer, request } from "node:http";
import { connect as connectSocket } from "node:net";
import { networkInterfaces } from "node:os";
export function tailscaleAddresses() {
    return Object.values(networkInterfaces()).flatMap((list) => list ?? []).filter((item) => {
        const parts = item.address.split(".").map(Number);
        return !item.internal && (parts.length === 4 && parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127 || item.address.toLowerCase().startsWith("fd7a:115c:a1e0:"));
    }).map((item) => item.address);
}
/** Direct workbench access over the system Tailscale network; no application credentials. */
export class RemoteAccess {
    target;
    addresses;
    port;
    servers = new Map();
    sockets = new Map();
    timer;
    busy = false;
    error = "";
    constructor(target, addresses = tailscaleAddresses, port = Number(new URL(target).port) || 4317) {
        this.target = target;
        this.addresses = addresses;
        this.port = port;
    }
    async initialize() {
        await this.refresh();
        this.timer = setInterval(() => void this.refresh(), 5000);
        this.timer.unref();
    }
    status() {
        return { urls: [...this.servers.keys()].map((ip) => `http://${ip.includes(":") ? `[${ip}]` : ip}:${this.port}/`), error: this.error,
            message: !this.servers.size ? "等待 Tailscale 网络，连接后会自动就绪。" : "" };
    }
    validSource(req, ip) {
        const expected = `${ip.includes(":") ? `[${ip}]` : ip}:${this.port}`;
        return req.headers.host === expected && (!req.headers.origin || req.headers.origin === `http://${expected}`) && req.headers["sec-fetch-site"] !== "cross-site";
    }
    headers(req) {
        const headers = { ...req.headers, host: new URL(this.target).host, origin: this.target };
        delete headers.authorization;
        delete headers.cookie;
        delete headers["forwarded"];
        delete headers["x-forwarded-host"];
        delete headers["x-forwarded-for"];
        delete headers["x-forwarded-proto"];
        headers["sec-fetch-site"] = "same-origin";
        return headers;
    }
    async refresh() {
        if (this.busy)
            return;
        this.busy = true;
        try {
            const wanted = this.addresses();
            for (const [ip, server] of this.servers)
                if (!wanted.includes(ip)) {
                    for (const [socket, owner] of this.sockets)
                        if (owner === ip)
                            socket.destroy();
                    server.closeAllConnections();
                    server.close();
                    this.servers.delete(ip);
                }
            this.error = "";
            for (const ip of wanted) {
                if (this.servers.has(ip))
                    continue;
                const server = createServer((req, res) => {
                    res.setHeader("Cache-Control", "no-store");
                    res.setHeader("X-Content-Type-Options", "nosniff");
                    res.setHeader("Referrer-Policy", "no-referrer");
                    res.setHeader("X-Frame-Options", "DENY");
                    if (!req.url?.startsWith("/") || req.url.startsWith("//")) {
                        res.writeHead(400);
                        res.end("请求路径无效");
                        return;
                    }
                    const path = new URL(req.url, this.target).pathname;
                    const navigation = req.method === "GET" && req.url === "/" && !req.headers.origin;
                    if (!this.validSource(req, ip) && !(navigation && req.headers.host === `${ip.includes(":") ? `[${ip}]` : ip}:${this.port}`)) {
                        res.writeHead(403);
                        res.end("来源校验失败");
                        return;
                    }
                    if (path === "/api/remote") {
                        res.writeHead(403);
                        res.end("连接诊断仅限本机访问");
                        return;
                    }
                    const upstream = request(this.target, { path: req.url ?? "/", method: req.method, headers: this.headers(req) }, (reply) => { res.writeHead(reply.statusCode ?? 502, reply.headers); reply.pipe(res); });
                    upstream.on("error", () => { if (!res.headersSent)
                        res.writeHead(502); res.end("后台正在恢复，请稍后重试"); });
                    req.on("aborted", () => upstream.destroy());
                    res.on("close", () => upstream.destroy());
                    req.pipe(upstream);
                });
                server.on("connection", (socket) => { this.sockets.set(socket, ip); socket.on("close", () => this.sockets.delete(socket)); });
                server.on("upgrade", (req, socket, head) => {
                    if (req.url !== "/ws" || !this.validSource(req, ip) || !req.headers.origin) {
                        socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
                        return;
                    }
                    const target = new URL(this.target);
                    const upstream = connectSocket(Number(target.port), target.hostname);
                    upstream.on("connect", () => {
                        const headers = this.headers(req);
                        upstream.write(`GET /ws HTTP/1.1\r\n${Object.entries(headers).filter(([, v]) => v !== undefined).map(([k, v]) => `${k}: ${v}`).join("\r\n")}\r\n\r\n`);
                        if (head.length)
                            upstream.write(head);
                        socket.pipe(upstream).pipe(socket);
                    });
                    upstream.on("error", () => socket.destroy());
                    socket.on("error", () => upstream.destroy());
                    socket.on("close", () => upstream.destroy());
                    upstream.on("close", () => socket.destroy());
                });
                try {
                    await new Promise((resolve, reject) => { server.once("error", reject); server.listen(this.port, ip, resolve); });
                    server.on("error", (error) => { this.error = error.message; });
                    this.servers.set(ip, server);
                }
                catch (error) {
                    this.error = `内网端口 ${this.port} 未能监听：${error.message}`;
                    server.close();
                }
            }
        }
        finally {
            this.busy = false;
        }
    }
    async stopListeners() {
        for (const socket of this.sockets.keys())
            socket.destroy();
        await Promise.all([...this.servers.values()].map((server) => new Promise((resolve) => { server.closeAllConnections(); server.close(() => resolve()); })));
        this.servers.clear();
    }
    async close() { clearInterval(this.timer); while (this.busy)
        await new Promise((r) => setTimeout(r, 10)); await this.stopListeners(); }
}
//# sourceMappingURL=remote-access.js.map