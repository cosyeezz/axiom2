import assert from "node:assert/strict";
import { test } from "node:test";
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync,
  readFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { WebSocket } from "ws";
import { Store } from "../src/server/storage.js";
import { configuration } from "../src/server/models.js";
import { startServer } from "../src/server/index.js";
import { Preferences } from "../src/server/preferences.js";
import { ModelService } from "../src/server/model-service.js";
import type { Command, Session, Workspace } from "../src/shared/protocol.js";

const temporary = () => mkdtempSync(join(tmpdir(), "axiom-check-"));
test("SQLite: authorization, ownership, idempotency, no server drafts and restart", () => {
  const root = temporary();
  let store = new Store(root);
  try {
    assert.throws(() => new Store(root), { code: "SERVICE_ALREADY_RUNNING" });
    const run = (
      op: string,
      params = {},
      workspaceId?: string,
      sessionId?: string,
    ) =>
      store.execute({
        requestId: randomUUID(),
        op,
        params,
        workspaceId,
        sessionId,
      });
    assert.throws(() => run("workspace.open", { path: root }), {
      code: "AUTHORIZATION_REQUIRED",
    });
    assert.throws(
      () => run("workspace.open", { path: "./", authorized: true }),
      { code: "INVALID_PATH" },
    );
    const a = run("workspace.open", {
      path: root,
      authorized: true,
    }) as Workspace;
    assert.equal(
      (run("workspace.open", { path: root, authorized: true }) as Workspace).id,
      a.id,
    );
    const path = join(root, "另一个项目");
    mkdirSync(path);
    const b = run("workspace.open", { path, authorized: true }) as Workspace;
    const creation: Command = {
      requestId: randomUUID(),
      op: "session.create",
      workspaceId: a.id,
    };
    const s = store.execute(creation) as Session;
    assert.deepEqual(store.execute(creation), s);
    assert.equal(store.sessions(a.id).length, 1);
    assert.throws(() => store.execute({ ...creation, workspaceId: b.id }), {
      code: "REQUEST_CONFLICT",
    });
    for (const op of [
      "session.rename",
      "session.pin",
      "session.delete",
      "draft.save",
      "prompt",
    ]) {
      assert.throws(
        () =>
          run(
            op,
            {
              title: "foreign",
              pinned: true,
              confirmed: true,
              text: "foreign",
            },
            b.id,
            s.id,
          ),
        { code: "SCOPE_MISMATCH" },
      );
    }
    assert.throws(() => run("prompt", { text: "do not run" }, a.id, s.id), {
      code: "UNKNOWN_OPERATION",
    });
    assert.throws(() => run("session.delete", {}, a.id, s.id), {
      code: "CONFIRMATION_REQUIRED",
    });
    run("session.rename", { title: "中文会话" }, a.id, s.id);
    run("session.pin", { pinned: true }, a.id, s.id);
    for (const op of ["draft.save", "draft.get", "draft.list"])
      assert.throws(() => run(op, { viewId: "tab-a", text: "not persisted" }, a.id, s.id), { code: "UNKNOWN_OPERATION" });
    assert.equal(store.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='drafts'").get(), undefined);
    // Upgrade an existing database without inventing ownership for old receipts.
    store.db.exec(
      "ALTER TABLE requests DROP COLUMN scope; ALTER TABLE external_requests DROP COLUMN scope",
    );
    store.close();
    store = new Store(root);
    assert.equal(store.session(a.id, s.id).title, "中文会话");
    assert.equal(store.session(a.id, s.id).pinned, true);
    assert.equal(store.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='drafts'").get(), undefined);
    assert.deepEqual(store.receipt(creation.requestId, { workspaceId: a.id }), {
      status: "uncertain",
    });
    assert.deepEqual(store.receipt(creation.requestId), {
      status: "committed",
      data: s,
    });
    store.db.exec(
      "CREATE TEMP TRIGGER fail_write BEFORE UPDATE ON sessions BEGIN SELECT RAISE(ABORT,'disk failure check'); END",
    );
    assert.throws(() =>
      run("session.rename", { title: "must not commit" }, a.id, s.id),
    );
    assert.equal(store.session(a.id, s.id).title, "中文会话");
    store.db.exec("DROP TRIGGER fail_write");
    run("session.delete", { confirmed: true }, a.id, s.id);
    assert.equal(
      store.sessions(a.id).length,
      0,
    );
    assert.equal(readFileSync(join(root, "axiom.sqlite")).length > 0, true);
  } finally {
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("Model summaries: only explicitly configured + authenticated models, no secrets", async (t) => {
  const root = temporary(),
    dir = join(root, "pi");
  const previousPi = process.env.AXIOM_PI_DIR;
  process.env.AXIOM_PI_DIR = dir;
  t.after(() => { if (previousPi === undefined) delete process.env.AXIOM_PI_DIR; else process.env.AXIOM_PI_DIR = previousPi; });
  mkdirSync(dir);
  try {
    assert.deepEqual((await configuration(root)).available, []);
    const config = {
      providers: {
        "axiom-local-check": {
          api: "openai-completions",
          baseUrl: "http://127.0.0.1:1/v1",
          models: [{ id: "only-configured", name: "Explicit" }],
        },
      },
    };
    writeFileSync(join(dir, "models.json"), JSON.stringify(config));
    const unauthed = await configuration(root);
    assert.equal(unauthed.error, undefined);
    assert.equal(unauthed.modelCount, 1);
    assert.deepEqual(unauthed.available, []);
    writeFileSync(
      join(dir, "auth.json"),
      JSON.stringify({
        "axiom-local-check": {
          type: "api_key",
          key: "TEST-ONLY-NOT-A-REAL-SECRET",
        },
      }),
    );
    const available = await configuration(root);
    assert.equal(available.error, undefined);
    assert.deepEqual(available.available, [
      {
        provider: "axiom-local-check",
        id: "only-configured",
        name: "Explicit",
        levels: ["off"],
      },
    ]);
    assert.ok(!JSON.stringify(available).includes("TEST-ONLY"));
    const store = new Store(root);
    try {
      const preferences = new Preferences(store),
        models = new ModelService(root);
      const favorite = {
        requestId: randomUUID(),
        op: "favorites.set",
        params: {
          provider: "axiom-local-check",
          id: "only-configured",
          favorite: true,
        },
      };
      await preferences.command(favorite, available);
      assert.equal(preferences.favorites().length, 1);
      writeFileSync(join(dir, "auth.json"), "{}");
      preferences.prune(await models.read());
      assert.equal(
        preferences.favorites().length,
        1,
        "temporary authentication loss must not delete favorites",
      );
      writeFileSync(join(dir, "models.json"), '{"providers":{}}');
      preferences.prune(await models.read());
      assert.deepEqual(preferences.favorites(), []);
      await assert.rejects(
        preferences.command(
          { ...favorite, requestId: randomUUID() },
          await configuration(root),
        ),
        { code: "MODEL_UNAVAILABLE" },
      );
    } finally {
      store.close();
    }
    writeFileSync(join(dir, "models.json"), "{invalid-secret-config");
    assert.ok((await configuration(root)).error);
    assert.equal(
      readFileSync(join(dir, "models.json"), "utf8"),
      "{invalid-secret-config",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("HTTP/WS: local access, scoped snapshots, recoverable receipts, no mutation replay", async (t) => {
  const root = temporary();
  const previousPi = process.env.AXIOM_PI_DIR;
  process.env.AXIOM_PI_DIR = join(root, "pi");
  t.after(() => { if (previousPi === undefined) delete process.env.AXIOM_PI_DIR; else process.env.AXIOM_PI_DIR = previousPi; });
  const app = await startServer({ root, port: 0 });
  const clients: WebSocket[] = [];
  try {
    assert.equal((await fetch(app.origin + "/api/status")).status, 200);
    assert.equal(
      (
        await fetch(app.origin + "/api/status", {
          headers: { Origin: "https://evil.example" },
        })
      ).status,
      403,
    );
    assert.equal(new URL(app.accessUrl).hash, "");
    const access = "";
    assert.equal(
      (
        await fetch(app.origin + "/api/access", {
          method: "POST",
          headers: { Origin: "https://evil.example" },
        })
      ).status,
      403,
    );
    const login = await fetch(app.origin + "/api/access", {
      method: "POST",
      headers: { Origin: app.origin, "X-Axiom-Access": access },
    });
    assert.equal(login.status, 204);
    assert.equal(login.headers.get("set-cookie"), null);
    const cookie = "";
    assert.equal(
      (await fetch(app.origin + "/api/status", { headers: { Cookie: cookie } }))
        .status,
      200,
    );
    async function connect() {
      const ws = new WebSocket(app.origin.replace("http", "ws") + "/ws", {
        headers: { Cookie: cookie, Origin: app.origin },
      });
      clients.push(ws);
      const messages: any[] = [];
      ws.on("message", (raw) => messages.push(JSON.parse(raw.toString())));
      await once(ws, "open");
      return {
        ws,
        messages,
        call: (c: Partial<Command> & { op: string }) =>
          new Promise<any>((resolve, reject) => {
            const requestId = c.requestId ?? randomUUID();
            const timer = setTimeout(() => {
              ws.off("message", receive);
              reject(Error("receipt timeout"));
            }, 3000);
            function receive(raw: Buffer) {
              const value = JSON.parse(raw.toString());
              if (value.type === "receipt" && value.requestId === requestId) {
                clearTimeout(timer);
                ws.off("message", receive);
                resolve(value);
              }
            }
            ws.on("message", receive);
            ws.send(JSON.stringify({ ...c, requestId }));
          }),
      };
    }
    const first = await connect();
    const probeId = randomUUID();
    const probe = await first.call({ op: "ping", requestId: probeId });
    assert.equal(probe.ok, true);
    assert.equal(probe.data.streamId, first.messages.find((message) => message.type === "hello")?.streamId);
    assert.equal(first.messages.filter((message) => message.type === "snapshot").length, 0, "liveness probes do not subscribe or publish");
    assert.equal(app.store.db.prepare("SELECT id FROM requests WHERE id=?").get(probeId), undefined, "liveness probes do not persist receipts");
    await first.call({ op: "subscribe", params: { scope: "workspaces" } });
    const opened = await first.call({
      op: "workspace.open",
      params: { path: root, authorized: true },
    });
    const w = opened.data as Workspace;
    const requestId = randomUUID();
    const created = await first.call({
      op: "session.create",
      workspaceId: w.id,
      requestId,
    });
    assert.equal(created.ok, true);
    const s = created.data as Session;
    await first.call({ op: "subscribe", params: { scope: "pinned-sessions" } });
    const otherPath = join(root, "pinned-project");
    mkdirSync(otherPath);
    const otherWorkspace = (await first.call({
      op: "workspace.open", params: { path: otherPath, authorized: true },
    })).data as Workspace;
    const otherSession = (await first.call({
      op: "session.create", workspaceId: otherWorkspace.id,
    })).data as Session;
    const latestPins = () => first.messages.filter(
      (m) => m.type === "snapshot" && m.scope === "pinned-sessions",
    ).at(-1)!.data as Session[];
    for (const session of [s, otherSession]) {
      await first.call({
        op: "session.pin", workspaceId: session.workspaceId, sessionId: session.id,
        params: { pinned: true },
      });
    }
    assert.deepEqual(new Set(latestPins().map((s) => s.id)), new Set([s.id, otherSession.id]));
    assert.equal((await first.call({
      op: "session.rename", workspaceId: w.id, sessionId: otherSession.id,
      params: { title: "wrong owner" },
    })).ok, false);
    await first.call({
      op: "session.rename", workspaceId: otherWorkspace.id, sessionId: otherSession.id,
      params: { title: "global pin renamed" },
    });
    assert.equal(latestPins().find((s) => s.id === otherSession.id)?.title, "global pin renamed");
    await first.call({
      op: "session.pin", workspaceId: otherWorkspace.id, sessionId: otherSession.id,
      params: { pinned: false },
    });
    assert.deepEqual(latestPins().map((s) => s.id), [s.id]);
    const snap = await first.call({
      op: "subscribe",
      params: { scope: `session:${w.id}:${s.id}` },
    });
    assert.equal(snap.ok, true);
    const denied = await first.call({
      op: "subscribe",
      params: { scope: `session:other:${s.id}` },
    });
    assert.equal(denied.ok, false);
    const before = first.messages.filter((m) => m.type === "snapshot");
    assert.ok(
      before.some(
        (m) => m.scope === `session:${w.id}:${s.id}` && m.data.id === s.id,
      ),
    );
    first.ws.close();
    await once(first.ws, "close");
    const second = await connect();
    assert.equal(
      (await second.call({ op: "request.get", params: { requestId } })).error
        .code,
      "REQUEST_SCOPE_MISMATCH",
    );
    const receipt = await second.call({
      op: "request.get",
      workspaceId: w.id,
      params: { requestId },
    });
    assert.equal(receipt.data.status, "committed");
    assert.equal(receipt.data.data.id, s.id);
    assert.equal(
      (
        await second.call({
          op: "request.get",
          workspaceId: w.id,
          sessionId: s.id,
          params: { requestId },
        })
      ).error.code,
      "REQUEST_SCOPE_MISMATCH",
    );
    // Pre-upgrade receipts with unknown ownership expose no data and never invite replay.
    app.store.db
      .prepare("UPDATE requests SET scope=NULL WHERE id=?")
      .run(requestId);
    assert.deepEqual(
      (
        await second.call({
          op: "request.get",
          workspaceId: w.id,
          params: { requestId },
        })
      ).data,
      { status: "uncertain" },
    );
    const duplicate = await second.call({
      op: "session.create",
      workspaceId: w.id,
      requestId,
    });
    assert.equal(duplicate.data.id, s.id);
    assert.equal(app.store.sessions(w.id).length, 1);
    assert.equal(
      (
        await second.call({
          op: "prompt",
          workspaceId: w.id,
          sessionId: s.id,
          params: { text: "never send" },
        })
      ).error.code,
      "MODEL_UNAVAILABLE",
    );
    const observer = await connect();
    await observer.call({
      op: "subscribe",
      params: { scope: "authentication" },
    });
    await second.call({ op: "subscribe", params: { scope: "configuration" } });
    const draft = (await second.call({ op: "configuration.get" })).data;
    draft.providers = [
      {
        id: "draft",
        providerId: "axiom-ws-auth",
        name: "WS test",
        api: "openai-completions",
        url: "http://127.0.0.1:1/v1",
        key: "",
        headers: [],
        body: [],
        models: [],
      },
    ];
    const publication = {
      op: "configuration.save",
      requestId: randomUUID(),
      params: draft,
    };
    assert.equal((await second.call(publication)).ok, true);
    const revision = (await second.call({ op: "configuration.get" })).data
      .revision;
    const start = {
      op: "auth.start",
      requestId: randomUUID(),
      params: { providerId: "axiom-ws-auth", type: "api_key", revision },
    };
    const started = await second.call(start);
    assert.equal(started.ok, true);
    assert.equal(
      (await second.call(start)).data.id,
      started.data.id,
      "duplicate starts never restart login",
    );
    // Login runs in the model network worker, so its prompt arrives after auth.start.
    const findPrompt = () => second.messages.find(
      (m) =>
        m.scope === "authentication" &&
        m.data?.id === started.data.id &&
        m.data.prompt,
    )?.data.prompt;
    for (const deadline = Date.now() + 10_000; !findPrompt() && Date.now() < deadline;)
      await new Promise((resolve) => setTimeout(resolve, 20));
    const prompt = findPrompt();
    assert.ok(prompt);
    const input = {
      id: started.data.id,
      promptId: prompt.id,
      answer: "WS-PRIVATE-KEY",
    };
    assert.equal(
      (await observer.call({ op: "auth.answer", params: input })).error.code,
      "AUTH_SCOPE_MISMATCH",
    );
    assert.equal(
      (
        await second.call({
          op: "configuration.save",
          params: { ...draft, revision },
        })
      ).error.code,
      "AUTH_BUSY",
    );
    assert.equal(
      (
        await second.call({
          op: "auth.answer",
          params: { ...input, answer: "!must-not-run" },
        })
      ).error.code,
      "INVALID_INPUT",
    );
    assert.equal(
      (await second.call({ op: "auth.answer", params: input })).ok,
      true,
    );
    for (
      let n = 0;
      n < 100 &&
      !second.messages.some(
        (m) => m.scope === "authentication" && m.data?.status === "completed",
      );
      n++
    )
      await new Promise((r) => setTimeout(r, 10));
    assert.ok(
      second.messages.some(
        (m) => m.scope === "authentication" && m.data?.status === "completed",
      ),
    );
    assert.ok(
      !observer.messages.some((m) => m.scope === "authentication" && m.data),
    );
    assert.ok(!JSON.stringify(second.messages).includes("WS-PRIVATE-KEY"));
    assert.ok(
      !JSON.stringify(
        app.store.db.prepare("SELECT * FROM external_requests").all(),
      ).includes("WS-PRIVATE-KEY"),
    );
    assert.equal(
      (
        await observer.call({
          op: "request.get",
          params: { requestId: publication.requestId },
        })
      ).data.status,
      "committed",
    );
    assert.deepEqual(
      (await observer.call(publication)).data,
      (await second.call(publication)).data,
    );
    const ongoing = await second.call({ ...start, requestId: randomUUID() });
    assert.equal(ongoing.ok, true);
    second.ws.close();
    await once(second.ws, "close");
    // Reconnection provides no authentication URLs/prompts from the old connection and no login replay.
    const reconnected = await connect();
    await reconnected.call({
      op: "subscribe",
      params: { scope: "authentication" },
    });
    assert.ok(
      !reconnected.messages.some((m) => m.scope === "authentication" && m.data),
    );
    assert.equal(
      (
        await reconnected.call({
          op: "auth.cancel",
          params: { id: ongoing.data.id },
        })
      ).error.code,
      "AUTH_SCOPE_MISMATCH",
    );
    const current = (await reconnected.call({ op: "configuration.get" })).data;
    assert.equal(
      current.providers[0].auth.type,
      "api_key",
      "disconnect does not clear prior credentials",
    );
    // Leave a pending prompt: service shutdown must abort it before closing the journal.
    assert.equal(
      (await reconnected.call({ ...start, requestId: randomUUID() })).ok,
      true,
    );
    const alien = new WebSocket(app.origin.replace("http", "ws") + "/ws", {
      headers: { Cookie: cookie, Origin: "https://evil.example" },
    });
    await new Promise<void>((resolve) => {
      alien.once("unexpected-response", (_req, res) => {
        assert.equal(res.statusCode, 403);
        res.resume();
        alien.terminate();
        resolve();
      });
      alien.on("error", () => {});
    });
  } finally {
    for (const ws of clients) ws.terminate();
    await app.close();
    rmSync(root, { recursive: true, force: true });
  }
});
