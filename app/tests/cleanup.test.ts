import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "node:http";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { startServer } from "../src/server/index.js";
import type { Workspace, Session } from "../src/shared/protocol.js";

test(
  "Forced stop: uncooperative pi tool and owned descendants terminate; fresh prompt and deletion need no confirmation",
  { timeout: 45000 },
  async (t) => {
    const root = mkdtempSync(join(tmpdir(), "axiom-cleanup-")),
      project = join(root, "project");
    const previousPi = process.env.AXIOM_PI_DIR;
    process.env.AXIOM_PI_DIR = join(root, "pi");
    t.after(() => { if (previousPi === undefined) delete process.env.AXIOM_PI_DIR; else process.env.AXIOM_PI_DIR = previousPi; });
    mkdirSync(project);
    mkdirSync(join(root, "pi/extensions"), { recursive: true });
    // Deliberately uncooperative installed resource, confined to this test's isolated application directory.
    writeFileSync(
      join(root, "pi/extensions/stubborn.ts"),
      `import {spawn} from 'node:child_process';import {writeFileSync} from 'node:fs';
export default function(pi){pi.registerTool({name:'stubborn',label:'stubborn',description:'Test uncooperative execution',parameters:{type:'object',properties:{}},async execute(){const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});writeFileSync('owned-processes.json',JSON.stringify({worker:process.pid,child:child.pid}));await new Promise(()=>{});}});}`,
    );
    let requests = 0;
    const fixture = createServer(async (req, res) => {
      requests++;
      for await (const _ of req) {
        /* drain */
      }
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      if (requests > 1) {
        res.end(`data: ${JSON.stringify({ id: "fresh", object: "chat.completion.chunk", model: "fixture", choices: [{ index: 0, delta: { role: "assistant", content: "Fresh prompt completed." }, finish_reason: "stop" }] })}\n\ndata: [DONE]\n\n`);
        return;
      }
      for (const [delta, finish_reason] of [
        [
          {
            role: "assistant",
            tool_calls: [
              {
                index: 0,
                id: "hang",
                type: "function",
                function: { name: "stubborn", arguments: "{}" },
              },
            ],
          },
          null,
        ],
        [{}, "tool_calls"],
      ])
        res.write(
          `data: ${JSON.stringify({ id: "cleanup", object: "chat.completion.chunk", model: "fixture", choices: [{ index: 0, delta, finish_reason }] })}\n\n`,
        );
      res.end("data: [DONE]\n\n");
    });
    await new Promise<void>((r) => fixture.listen(0, "127.0.0.1", r));
    writeFileSync(
      join(root, "pi/models.json"),
      JSON.stringify({
        providers: {
          fixture: {
            api: "openai-completions",
            baseUrl: `http://127.0.0.1:${(fixture.address() as any).port}/v1`,
            models: [{ id: "fixture" }],
          },
        },
      }),
    );
    writeFileSync(
      join(root, "pi/auth.json"),
      JSON.stringify({ fixture: { type: "api_key", key: "fixture" } }),
    );
    const start = process.env.AXIOM_TEST_COMPILED
      ? ((
          await import(new URL("../dist/server/index.js", import.meta.url).href)
        ).startServer as typeof startServer)
      : startServer;
    let app = await start({ root, port: 0 });
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
      const scope = { workspaceId: w.id, sessionId: s.id };
      const call = (op: string, params = {}) =>
        app.tasks.command({ requestId: randomUUID(), op, params, ...scope });
      await call("agent.model", {
        selection: { provider: "fixture", id: "fixture", thinking: "off" },
      });
      await call("prompt", { text: "Run the test tool" });
      for (
        let i = 0;
        i < 400 && !existsSync(join(project, "owned-processes.json"));
        i++
      )
        await new Promise((r) => setTimeout(r, 25));
      assert.ok(
        existsSync(join(project, "owned-processes.json")),
        "uncooperative tool must actually start",
      );
      const pids = JSON.parse(
        readFileSync(join(project, "owned-processes.json"), "utf8"),
      );
      const at = Date.now();
      const file = app.store.db.prepare("SELECT file FROM agent_sessions WHERE sessionId=?").get(s.id)!.file;
      await app.agents.stop(scope);
      assert.equal(requests, 1, "stopping must not issue a summary request");
      assert.ok(Date.now() - at < 10000, "owned termination must be bounded");
      for (const pid of [pids.worker, pids.child]) {
        for (let i = 0; i < 100; i++) {
          try {
            process.kill(pid, 0);
          } catch {
            break;
          }
          await new Promise((r) => setTimeout(r, 25));
        }
        assert.throws(() => process.kill(pid, 0), { code: "ESRCH" });
      }
      assert.equal(app.agents.info(scope).run!.status, "cancelled");
      assert.ok(!("cleanup" in app.agents.info(scope).run!));
      await call("prompt", { text: "Fresh work immediately after forced stop" });
      for (let i = 0; i < 400 && !app.agents.info(scope).run!.endedAt; i++)
        await new Promise((r) => setTimeout(r, 25));
      assert.equal(app.agents.info(scope).run!.status, "completed");
      assert.equal(requests, 2);
      assert.equal(app.store.db.prepare("SELECT file FROM agent_sessions WHERE sessionId=?").get(s.id)!.file, file);
      await app.close();
      app = await start({ root, port: 0 });
      assert.equal(requests, 2, "restart cannot replay requests");
      await app.tasks.remove({
        requestId: randomUUID(),
        op: "session.delete",
        params: { confirmed: true },
        ...scope,
      });
      assert.ok(
        existsSync(join(project, "owned-processes.json")),
        "deletion must preserve project files",
      );
    } finally {
      await app.close();
      fixture.closeAllConnections();
      await new Promise<void>((r) => fixture.close(() => r()));
      rmSync(root, { recursive: true, force: true });
    }
  },
);
