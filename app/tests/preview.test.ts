import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer, request } from "node:http";
import { randomUUID } from "node:crypto";
import { startServer } from "../src/server/index.js";
import type { PreviewView } from "../src/server/preview/service.js";
import type { Scope, Session, Workspace } from "../src/shared/protocol.js";
function get(
  view: PreviewView,
  path = "/",
  headers: Record<string, string> = {},
  method = "GET",
) {
  return new Promise<{
    status: number;
    body: string;
    headers: Record<string, unknown>;
  }>((resolve, reject) => {
    const url = new URL(view.origin);
    const req = request(
      {
        hostname: "127.0.0.1",
        port: url.port,
        path,
        method,
        headers: { host: url.host, ...headers },
      },
      (r) => {
        let body = "";
        r.on("data", (c) => (body += c));
        r.on("end", () =>
          resolve({ status: r.statusCode!, body, headers: r.headers }),
        );
      },
    );
    req.on("error", reject);
    req.end();
  });
}
test(
  "Preview: owned instances, separate cookie host, path/privacy boundaries, revisions, receipts and bounded process cleanup",
  { timeout: 30000 },
  async () => {
    const root = mkdtempSync(join(tmpdir(), "axiom-preview-")),
      project = join(root, "project");
    mkdirSync(project);
    mkdirSync(join(project, "site"));
    writeFileSync(
      join(project, "site", "index.html"),
      "<!doctype html><h1>Hello</h1>",
    );
    writeFileSync(join(project, "site", "auth.json"), "secret");
    writeFileSync(join(root, "outside.html"), "private");
    let app = await startServer({ root, port: 0 });
    try {
      const w = app.store.execute({
        requestId: randomUUID(),
        op: "workspace.open",
        params: { path: project, authorized: true },
      }) as Workspace;
      const s = app.store.execute({
        requestId: randomUUID(),
        op: "session.create",
        workspaceId: w.id,
      }) as Session;
      const other = app.store.execute({
        requestId: randomUUID(),
        op: "session.create",
        workspaceId: w.id,
      }) as Session;
      const scope: Scope = { workspaceId: w.id, sessionId: s.id };
      const call = (
        op: string,
        params: Record<string, unknown> = {},
        to = scope,
        id = randomUUID(),
      ) => app.previews.command({ op, params, ...to, requestId: id });
      await assert.rejects(
        call("preview.open", { mode: "static", directory: "site" }),
        { code: "AUTHORIZATION_REQUIRED" },
      );
      await assert.rejects(
        call("preview.open", {
          mode: "static",
          directory: "..",
          authorized: true,
        }),
        { code: "PREVIEW_PATH" },
      );
      const id = randomUUID(),
        params = { mode: "static", directory: "site", authorized: true };
      const view = (await call(
        "preview.open",
        params,
        scope,
        id,
      )) as PreviewView;
      assert.deepEqual(await call("preview.open", params, scope, id), view);
      assert.equal(app.previews.list(scope).length, 1);
      assert.match(new URL(view.origin).hostname, /^p-[a-f0-9]+\.localhost$/);
      assert.notEqual(
        new URL(view.origin).hostname,
        new URL(app.origin).hostname,
      );
      const page = await get(view);
      assert.equal(page.status, 200);
      assert.match(page.body, /^<!doctype html><script/);
      assert.equal(page.headers["set-cookie"], undefined);
      for (const path of [
        "/auth.json",
        "/.env",
        "/../outside.html",
        "/%2e%2e%5coutside.html",
      ])
        assert.notEqual((await get(view, path)).status, 200);
      assert.equal((await get(view, "/", { host: "evil.test" })).status, 403);
      assert.equal(
        (await get(view, "/", { origin: "https://evil.test" })).status,
        403,
      );
      assert.equal((await get(view, "/", {}, "POST")).status, 405);
      await assert.rejects(
        call(
          "preview.close",
          { previewId: view.id },
          { workspaceId: w.id, sessionId: other.id },
        ),
        { code: "PREVIEW_SCOPE" },
      );
      const target = {
        url: view.url,
        revision: view.revision,
        selector: "h1",
        tag: "h1",
        text: "Hello",
        snippet: "<h1>Hello</h1>",
        rect: { x: 0, y: 0, width: 100, height: 20 },
        viewport: { width: 360, height: 800 },
      };
      await assert.rejects(
        call("annotation.send", {
          previewId: view.id,
          binding: "wrong",
          target,
          note: "change",
        }),
        { code: "PREVIEW_SCOPE" },
      );
      await call("preview.refresh", { previewId: view.id });
      await assert.rejects(
        call("annotation.send", {
          previewId: view.id,
          binding: view.binding,
          target,
          note: "change",
        }),
        { code: "PREVIEW_STALE" },
      );
      await call("preview.close", { previewId: view.id });
      const probe = createServer();
      await new Promise<void>((r) => probe.listen(0, "127.0.0.1", r));
      const port = (probe.address() as any).port;
      await new Promise<void>((r) => probe.close(() => r()));
      writeFileSync(
        join(project, "server.cjs"),
        `require('node:http').createServer((req,res)=>{res.setHeader('Content-Type','text/html');if(req.url==='/slow'){const timer=setInterval(()=>res.write('x'),100);res.on('close',()=>clearInterval(timer));return;}res.end('<h1>'+JSON.stringify(req.headers)+'</h1>');}).listen(process.env.PORT,'127.0.0.1')`,
      );
      const live = (await call("preview.open", {
        mode: "server",
        directory: ".",
        authorized: true,
        executable: "node",
        args: ["server.cjs"],
        port,
      })) as PreviewView;
      let result = await get(live, "/", {
        cookie: "axiom=must-not-forward",
        authorization: "secret",
      });
      for (let i = 0; result.status !== 200 && i < 30; i++) {
        await new Promise((r) => setTimeout(r, 50));
        result = await get(live, "/", {
          cookie: "axiom=must-not-forward",
          authorization: "secret",
        });
      }
      assert.equal(result.status, 200);
      assert.ok(
        !result.body.includes("must-not-forward") &&
          !result.body.includes("secret"),
      );
      const slowAt = Date.now();
      assert.equal((await get(live, "/slow")).status, 502);
      assert.ok(
        Date.now() - slowAt < 7000,
        "a trickling upstream must not extend the request deadline",
      );
      await assert.rejects(
        call(
          "annotation.receipt",
          { requestId: id },
          { workspaceId: w.id, sessionId: other.id },
        ),
        { code: "REQUEST_SCOPE_MISMATCH" },
      );
      assert.deepEqual(await call("preview.close", { previewId: live.id }), {
        closed: live.id,
        cleanup: "unconfirmed",
      });
      const cleanup = (await call("preview.cleanup.get")) as { id: string }[];
      assert.equal(cleanup.length, 1);
      await app.close();
      app = await startServer({ root, port: 0 });
      assert.equal(app.previews.list(scope).length, 0);
      assert.equal(((await call("preview.cleanup.get")) as any[]).length, 1);
      await assert.rejects(
        call("preview.cleanup.confirm", { confirmed: true, ids: ["foreign"] }),
        { code: "PREVIEW_STALE" },
      );
      await call("preview.cleanup.confirm", {
        confirmed: true,
        ids: cleanup.map((x) => x.id),
      });
      assert.deepEqual(await call("preview.cleanup.get"), []);
      const exiting = (await call("preview.open", {
        mode: "server",
        directory: ".",
        authorized: true,
        executable: "node",
        args: ["-e", "setTimeout(()=>process.exit(0),200)"],
        port,
      })) as PreviewView;
      for (let i = 0; i < 100 && app.previews.list(scope).length; i++)
        await new Promise((r) => setTimeout(r, 20));
      assert.equal(
        app.previews.list(scope).length,
        0,
        "exited processes must release the live-preview capacity",
      );
      assert.ok(
        ((await call("preview.cleanup.get")) as { id: string }[]).some(
          (record) => record.id === exiting.id,
        ),
      );
      await call("preview.cleanup.confirm", {
        confirmed: true,
        ids: [exiting.id],
      });
      // Annotation and session deletion use the same lock order, including a busy model writer.
      const current = (await call("preview.open", params)) as PreviewView;
      let release!: () => void;
      const held = app.agents.models.serial(
        () =>
          new Promise<void>((r) => {
            release = r;
          }),
      );
      while (!release) await new Promise((r) => setTimeout(r, 5));
      const annotation = call("annotation.send", {
        previewId: current.id,
        binding: current.binding,
        target: { ...target, url: current.url, revision: current.revision },
        note: "no model selected",
      });
      const rejected = assert.rejects(annotation, {
        code: "MODEL_UNAVAILABLE",
      });
      await new Promise((r) => setTimeout(r, 20));
      const deletion = {
        requestId: randomUUID(),
        op: "session.delete",
        ...scope,
        params: { confirmed: true },
      };
      const removing = app.previews.remove(deletion);
      release();
      await held;
      await Promise.all([rejected, removing]);
      assert.throws(() => app.store.session(w.id, s.id), {
        code: "SCOPE_MISMATCH",
      });
      await app.previews.remove(deletion); // durable duplicate, not another cleanup
      assert.ok(
        (await get(current).catch(() => ({ status: 0 }))).status !== 200,
      );
    } finally {
      await app.close();
      rmSync(root, { recursive: true, force: true });
    }
  },
);
