import { createServer, request, type Server } from "node:http";
import { randomBytes } from "node:crypto";
import { readFile, realpath, stat } from "node:fs/promises";
import { extname, resolve, relative, isAbsolute } from "node:path";
import { annotationScript } from "./annotation-script.js";
import { AppError } from "../../shared/protocol.js";

export async function contained(root: string, path: string) {
  const file = await realpath(resolve(root, path));
  const rel = relative(root, file);
  if (rel.startsWith("..") || isAbsolute(rel))
    throw new AppError("PREVIEW_PATH", "预览路径超出工作空间");
  return file;
}
const mime: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
  ".ico": "image/x-icon",
};
const blocked = (p: string) =>
  p
    .split(/[\\/]/)
    .some(
      (s) =>
        s.startsWith(".") ||
        ["agents.md", "auth.json", "models.json", "package-lock.json"].includes(
          s.toLowerCase(),
        ),
    ) || /\.(pem|key|sqlite|db|jsonl)$/i.test(p);
export async function gateway(input: {
  id: string;
  binding: string;
  directory: string;
  parentOrigin: string;
  revision: () => string;
  upstream?: number;
}) {
  // Cookies are not port-isolated. A capability hostname on .localhost keeps
  // application cookies on 127.0.0.1 out of the preview request entirely.
  const hostname = `p-${randomBytes(24).toString("hex")}.localhost`;
  let origin = "";
  const server: Server = createServer(async (req, res) => {
    try {
      res.setHeader("Referrer-Policy", "no-referrer");
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Cache-Control", "no-store");
      res.setHeader(
        "Content-Security-Policy",
        `frame-ancestors ${input.parentOrigin}`,
      );
      const u = new URL(req.url!, origin);
      if (
        req.headers.host !== new URL(origin).host ||
        (req.headers.origin &&
          ![origin, input.parentOrigin].includes(req.headers.origin))
      ) {
        res.writeHead(403);
        res.end();
        return;
      }
      if (!["GET", "HEAD"].includes(req.method!)) {
        res.writeHead(405);
        res.end("只读预览网关不代理写操作");
        return;
      }
      if (u.pathname === "/__axiom_annotation.js") {
        res.setHeader("Content-Type", "text/javascript");
        res.end(
          annotationScript(
            input.id,
            input.binding,
            input.parentOrigin,
            input.revision(),
          ),
        );
        return;
      }
      let body: Buffer,
        type: string,
        status = 200;
      if (input.upstream) {
        const response = await new Promise<{
          body: Buffer;
          type: string;
          status: number;
          csp?: string;
        }>((resolve, reject) => {
          const upstream = request(
            {
              hostname: "127.0.0.1",
              port: input.upstream,
              path: u.pathname + u.search,
              method: "GET",
              headers: { accept: req.headers.accept || "*/*" },
            },
            (r) => {
              const chunks: Buffer[] = [];
              let size = 0;
              r.on("data", (c) => {
                size += c.length;
                if (size > 10_000_000) {
                  r.destroy();
                  reject(Error("size"));
                } else chunks.push(c);
              });
              r.on("end", () =>
                resolve({
                  body: Buffer.concat(chunks),
                  type: String(
                    r.headers["content-type"] || "application/octet-stream",
                  ),
                  status: r.statusCode || 502,
                  csp:
                    typeof r.headers["content-security-policy"] === "string"
                      ? r.headers["content-security-policy"]
                      : undefined,
                }),
              );
              r.on("error", reject);
            },
          );
          const deadline = setTimeout(
            () => upstream.destroy(Error("timeout")),
            5000,
          );
          upstream.once("close", () => clearTimeout(deadline));
          upstream.on("error", reject);
          upstream.end();
        });
        ({ body, type, status } = response);
        if (response.csp)
          res.setHeader("Content-Security-Policy", [
            response.csp,
            `frame-ancestors ${input.parentOrigin}`,
          ]);
        if (status >= 300 && status < 400)
          throw Error("redirects are not proxied");
      } else {
        const path =
          decodeURIComponent(u.pathname).replace(/^\/+/, "") || "index.html";
        if (blocked(path)) throw Error("private file");
        let file = await contained(input.directory, path);
        if ((await stat(file)).isDirectory())
          file = await contained(input.directory, path + "/index.html");
        if (blocked(relative(input.directory, file)))
          throw Error("private real path");
        if ((await stat(file)).size > 10_000_000) throw Error("size");
        body = await readFile(file);
        type = mime[extname(file)] || "text/plain; charset=utf-8";
      }
      if (type.includes("text/html"))
        body = Buffer.from(
          body
            .toString("utf8")
            .replace(
              /^(<!doctype[^>]*>)?/i,
              '$&<script src="/__axiom_annotation.js"></script>',
            ),
        );
      res.writeHead(status, { "Content-Type": type });
      res.end(req.method === "HEAD" ? undefined : body);
    } catch {
      res.writeHead(502);
      res.end(
        "预览无法读取：检查路径、启动命令、端口或内容安全策略。未代理外部地址。",
      );
    }
  });
  // HMR is deliberately not proxied; an explicit refresh keeps the gateway read-only and bounded.
  server.on("upgrade", (_req, socket) => socket.destroy());
  await new Promise<void>((r, j) => {
    server.once("error", j);
    server.listen(0, "127.0.0.1", r);
  });
  origin = `http://${hostname}:${(server.address() as { port: number }).port}`;
  let closing: Promise<void> | undefined;
  return {
    origin,
    url: origin + "/",
    close: () =>
      (closing ??= (async () => {
        server.closeAllConnections();
        await new Promise<void>((r) => server.close(() => r()));
      })()),
  };
}
