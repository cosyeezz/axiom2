import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "./temporary.js";
import { join } from "node:path";
import WebSocket from "ws";
import { startServer } from "../src/server/index.js";
import { hasMarkdownImage, markdownImagePath } from "../src/shared/markdown.js";
import type { Command, Scope, Session, Workspace } from "../src/shared/protocol.js";

const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWZkAAAAASUVORK5CYII=";

test("Markdown image references use the parser, excluding code, HTML and ordinary links", () => {
  const href = "C:/生成图/with space.png";
  for (const source of [`![示意图](<${href}>)`, `> ![示意图][pic]\n\n[pic]: <${href}>`, `- **图片：**![图](<${href}>)`])
    assert.ok(hasMarkdownImage(source, href), source);
  for (const source of [`[普通链接](<${href}>)`, `\`![图](<${href}>)\``, `\`\`\`md\n![图](<${href}>)\n\`\`\``, `<img src="${href}">`])
    assert.equal(hasMarkdownImage(source, href), false, source);
  assert.equal(markdownImagePath(href), href);
  assert.equal(markdownImagePath("C:\\生成图\\a.png"), "C:/生成图/a.png");
  assert.equal(markdownImagePath("/tmp/a.png"), "/tmp/a.png");
  for (const source of ["https://example.com/a.png", "//server/a.png", "\\\\server\\a.png", "file:///C:/a.png", "javascript:alert(1)", "data:image/png;base64,AA==", "../a.png", "C:/a/../b.png", "C:/a.png:stream", "C:/a\0.png"])
    assert.equal(markdownImagePath(source), null, source);
});

test("Markdown images: real WS, historical assistant ownership, restart, errors and no read receipts", { timeout: 30000 }, async () => {
  const root = mkdtempSync(join(tmpdir(), "axiom-markdown-image-")), cwd = join(root, "project");
  mkdirSync(cwd); mkdirSync(join(root, "pi"));
  const previous = process.env.AXIOM_PI_DIR; process.env.AXIOM_PI_DIR = join(root, "pi");
  let app = await startServer({ root, port: 0 }), ws: WebSocket | undefined;
  try {
    const w = app.store.execute({ op: "workspace.open", requestId: randomUUID(), params: { path: cwd, authorized: true } }) as Workspace;
    const create = () => app.store.execute({ op: "session.create", requestId: randomUUID(), workspaceId: w.id }) as Session;
    const scope = { workspaceId: w.id, sessionId: create().id }, other = { ...scope, sessionId: create().id };
    const image = join(root, "generated image.png"), href = image.replace(/\\/g, "/");
    writeFileSync(image, Buffer.from(png, "base64"));
    const svgPath = join(root, "图标候选.svg"), svgHref = svgPath.replace(/\\/g, "/");
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M2 12h20" stroke="black"/></svg>';
    writeFileSync(svgPath, svg);
    const file = join(root, "bound.jsonl");
    writeFileSync(file, [
      { type: "session", version: 3, id: randomUUID(), timestamp: new Date().toISOString(), cwd },
      { type: "message", id: "reply", parentId: null, timestamp: new Date().toISOString(), message: { role: "assistant", content: [{ type: "text", text: `![生成的图片](<${href}>)\n![矢量图标](<${svgHref}>)` }], timestamp: 1 } },
      { type: "message", id: "user", parentId: "reply", timestamp: new Date().toISOString(), message: { role: "user", content: `![图](<${href}>)`, timestamp: 2 } },
      { type: "message", id: "code", parentId: "user", timestamp: new Date().toISOString(), message: { role: "assistant", content: [{ type: "text", text: `\`![图](<${href}>)\`` }], timestamp: 3 } },
    ].map((row) => JSON.stringify(row)).join("\n") + "\n");
    app.store.db.prepare("INSERT INTO agent_sessions(sessionId,file) VALUES(?,?)").run(scope.sessionId, file);
    const connect = async () => {
      ws = new WebSocket(app.origin.replace("http", "ws") + "/ws", { origin: app.origin });
      await new Promise<void>((resolve, reject) => { ws!.once("open", resolve); ws!.once("error", reject); });
    };
    const call = (target: Scope, params: Record<string, unknown>, op = "files.markdownImage") => {
      const c: Command = { ...target, op, params, requestId: randomUUID() };
      return new Promise<any>((resolve, reject) => {
        const receive = (raw: WebSocket.RawData) => {
          const value = JSON.parse(raw.toString()); if (value.requestId !== c.requestId) return;
          ws!.off("message", receive);
          assert.equal(app.store.receipt(c.requestId).status, "not_found");
          value.ok ? resolve(value.data) : reject(value.error);
        };
        ws!.on("message", receive); ws!.send(JSON.stringify(c));
      });
    };
    await connect();
    const params = { messageId: "reply", href };
    assert.equal((await call(scope, params)).data, png);
    assert.equal((await call(scope, params)).mimeType, "image/png");
    const svgParams = { messageId: "reply", href: svgHref };
    const vector = await call(scope, svgParams);
    assert.equal(vector.mimeType, "image/svg+xml");
    assert.equal(Buffer.from(vector.data, "base64").toString(), svg);
    await assert.rejects(call(other, svgParams), { code: "NOT_FOUND" });
    await assert.rejects(call(scope, { ...svgParams, messageId: "user" }), { code: "IMAGE_PREVIEW_FORBIDDEN" });
    writeFileSync(svgPath, '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"></svg>');
    await assert.rejects(call(scope, svgParams), { code: "INVALID_IMAGE" });
    writeFileSync(svgPath, svg);
    assert.ok(!JSON.stringify(app.agents.messages(scope)).includes(png));
    await assert.rejects(call(other, params), { code: "NOT_FOUND" });
    for (const messageId of ["user", "code"])
      await assert.rejects(call(scope, { ...params, messageId }), { code: "IMAGE_PREVIEW_FORBIDDEN" });
    await assert.rejects(call(scope, { ...params, href: href + ".other" }), { code: "IMAGE_PREVIEW_FORBIDDEN" });
    await assert.rejects(call(scope, { ...params, path: image }), { code: "INVALID_INPUT" });
    await assert.rejects(call(scope, { path: image }, "files.preview"), { code: "IMAGE_PREVIEW_FORBIDDEN" });
    app.store.db.prepare("UPDATE workspaces SET authorized=0 WHERE id=?").run(w.id);
    await assert.rejects(call(scope, params), { code: "AUTHORIZATION_REQUIRED" });
    app.store.db.prepare("UPDATE workspaces SET authorized=1 WHERE id=?").run(w.id);
    ws!.terminate(); await app.close(); app = await startServer({ root, port: 0 }); await connect();
    assert.equal((await call(scope, params)).data, png);
    assert.equal((await call(scope, svgParams)).mimeType, "image/svg+xml");
    writeFileSync(image, "<svg onload='alert(1)'></svg>");
    await assert.rejects(call(scope, params), { code: "INVALID_IMAGE" });
    const large = Buffer.alloc(10 * 1024 * 1024 + 1); Buffer.from(png, "base64").copy(large); writeFileSync(image, large);
    await assert.rejects(call(scope, params), { code: "IMAGE_TOO_LARGE" });
    rmSync(image);
    await assert.rejects(call(scope, params), { code: "IMAGE_NOT_FOUND" });
  } finally {
    ws?.terminate(); await app.close(); rmSync(root, { recursive: true, force: true });
    if (previous === undefined) delete process.env.AXIOM_PI_DIR; else process.env.AXIOM_PI_DIR = previous;
  }
});
