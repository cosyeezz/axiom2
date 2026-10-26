// Configuration-only CLI checks against an owned ephemeral mock WS server.
// These fixtures never send a prompt or contact the real AXIOM/model service.
import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { once } from "node:events";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";

const script = fileURLToPath(new URL("../scripts/kiro-live-check.mjs", import.meta.url));
const ids = { workspaceId: "workspace-fixture", parentSessionId: "parent-fixture", taskRef: "t7000" };
const envNames = ["AXIOM_KIRO_WORKSPACE_ID", "AXIOM_KIRO_PARENT_SESSION_ID", "AXIOM_KIRO_TASK_REF"];

async function fixture(t: TestContext) {
  const directory = mkdtempSync(join(tmpdir(), "axiom-kiro-scope-"));
  const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  t.after(async () => {
    for (const client of server.clients) client.terminate();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    rmSync(directory, { recursive: true, force: true });
  });
  await once(server, "listening"); const address = server.address(); assert.ok(address && typeof address === "object");
  let connections = 0;
  const requests: any[] = [];
  server.on("connection", ws => {
    connections++;
    ws.on("message", bytes => {
      const request = JSON.parse(bytes.toString()); requests.push(request);
      ws.send(JSON.stringify({ type: "receipt", requestId: request.requestId, ok: false, error: { code: "MOCK_STOP_BEFORE_TASK_ACCESS" } }));
    });
  });
  const origin = "http://127.0.0.1:" + address.port;
  async function run(statePath: string, flags: string[] = [], extraEnv: NodeJS.ProcessEnv = {}, command = "inspect", defaults = true) {
    const env = { ...process.env };
    for (const name of envNames) delete env[name];
    Object.assign(env, extraEnv);
    const child = spawn(process.execPath, [script, command, ...(defaults ? ["--origin", origin, "--state", statePath] : []), ...flags], { cwd: directory, env, stdio: ["ignore", "pipe", "pipe"] });
    let stderr = ""; child.stderr.setEncoding("utf8"); child.stderr.on("data", value => { stderr += value; });
    child.stdout.resume();
    const timer = setTimeout(() => child.kill(), 10_000);
    try { const [code, signal] = await once(child, "close"); return { code, signal, stderr }; }
    finally { clearTimeout(timer); }
  }
  return { directory, origin, requests, run, connections: () => connections };
}

test("Kiro live CLI requires explicit owned identity before opening any WebSocket", async t => {
  const f = await fixture(t);
  const cases = [
    [], ["--workspace", ids.workspaceId], ["--workspace", ids.workspaceId, "--parent", ids.parentSessionId],
    ["--workspace", "", "--parent", ids.parentSessionId, "--task", ids.taskRef],
  ];
  for (const [index, flags] of cases.entries()) {
    const path = join(f.directory, "missing-" + index + ".json"), result = await f.run(path, flags);
    assert.equal(result.code, 1); assert.match(result.stderr, /Pass --workspace, --parent and --task/);
    assert.equal(existsSync(path), false);
  }
  assert.equal(f.connections(), 0); assert.equal(f.requests.length, 0);
});

test("Kiro live CLI rejects explicit identity overrides that conflict with an existing state", async t => {
  const f = await fixture(t), statePath = join(f.directory, "existing.json");
  writeFileSync(statePath, JSON.stringify({ ...ids, taskId: "task-uuid-fixture", turns: [] }));
  for (const [flag, value] of [["--workspace", "other-workspace"], ["--parent", "other-parent"], ["--task", "t7999"]]) {
    const result = await f.run(statePath, [flag, value]);
    assert.equal(result.code, 1); assert.match(result.stderr, new RegExp("Existing state conflicts with " + flag));
  }
  assert.equal(f.connections(), 0); assert.equal(f.requests.length, 0);
});

test("Kiro live CLI accepts explicit flags and only discovers the owned task before the mock stops it", async t => {
  const f = await fixture(t), result = await f.run(join(f.directory, "explicit.json"), ["--workspace", ids.workspaceId, "--parent", ids.parentSessionId, "--task", ids.taskRef]);
  assert.equal(result.code, 1); assert.match(result.stderr, /MOCK_STOP_BEFORE_TASK_ACCESS/); assert.equal(f.connections(), 1);
  assert.equal(f.requests.length, 1); assert.equal(f.requests[0].op, "subscribe");
  assert.equal(f.requests[0].params.scope, "tasks:" + ids.workspaceId + ":" + ids.parentSessionId);
});

test("Kiro live CLI accepts named environment identity without hardcoded local defaults", async t => {
  const f = await fixture(t), result = await f.run(join(f.directory, "environment.json"), [], {
    AXIOM_KIRO_WORKSPACE_ID: ids.workspaceId, AXIOM_KIRO_PARENT_SESSION_ID: ids.parentSessionId, AXIOM_KIRO_TASK_REF: ids.taskRef,
  });
  assert.equal(result.code, 1); assert.match(result.stderr, /MOCK_STOP_BEFORE_TASK_ACCESS/); assert.equal(f.requests.length, 1);
  assert.equal(f.requests[0].params.scope, "tasks:" + ids.workspaceId + ":" + ids.parentSessionId);
});

test("Kiro live CLI keeps an existing owned state usable without repeating identity flags", async t => {
  const f = await fixture(t), statePath = join(f.directory, "stored.json");
  writeFileSync(statePath, JSON.stringify({ ...ids, turns: [] }));
  const result = await f.run(statePath);
  assert.equal(result.code, 1); assert.match(result.stderr, /MOCK_STOP_BEFORE_TASK_ACCESS/); assert.equal(f.requests.length, 1);
  assert.equal(f.requests[0].params.scope, "tasks:" + ids.workspaceId + ":" + ids.parentSessionId);
});

test("Kiro live CLI rejects every missing value before connecting, including send text followed by a flag", async t => {
  const f = await fixture(t), state = join(f.directory, "all-values.json");
  const identity = ["--workspace", ids.workspaceId, "--parent", ids.parentSessionId, "--task", ids.taskRef];
  const flags = ["--workspace", "--parent", "--task", "--state", "--origin", "--fixture-root", "--tool-cwd", "--pace-ms", "--receipt-tag", "--model", "--thinking", "--text", "--prompt-file", "--label", "--image", "--attachment-file"];
  for (const flag of flags) {
    const pairs = ["--origin", f.origin, "--state", state, ...identity];
    const at = pairs.indexOf(flag); if (at >= 0) pairs.splice(at, 2);
    for (const tail of [[flag], [flag, "--label", "not-a-value"]]) {
      const result = await f.run(state, [...pairs, ...tail], {}, "inspect", false);
      assert.equal(result.code, 1); assert.match(result.stderr, /Pass (?:a value for|--workspace)/);
    }
  }
  const result = await f.run(state, [...identity, "--text", "--label", "x"], {}, "send");
  assert.equal(result.code, 1); assert.match(result.stderr, /Pass a value for --text/);
  assert.equal(f.connections(), 0); assert.equal(f.requests.length, 0); assert.equal(existsSync(state), false);
});

test("Kiro live CLI rejects duplicate, unknown and conflicting inputs before connecting", async t => {
  const f = await fixture(t), state = join(f.directory, "ambiguous.json");
  const identity = ["--workspace", ids.workspaceId, "--parent", ids.parentSessionId, "--task", ids.taskRef];
  for (const flags of [["--state", state], ["--vision", "--vision"], ["--text", "one", "--text", "two"], ["--unknown"], ["unexpected-position"]]) {
    const result = await f.run(state, [...identity, ...flags]);
    assert.equal(result.code, 1); assert.match(result.stderr, /Duplicate option|Unknown option/);
  }
  for (const flags of [[], ["--text", "one", "--prompt-file", "not-read.txt"]]) {
    const result = await f.run(state, [...identity, ...flags], {}, "send");
    assert.equal(result.code, 1); assert.match(result.stderr, /Pass exactly one/);
  }
  const unknown = await f.run(state, identity, {}, "not-a-command");
  assert.equal(unknown.code, 1); assert.match(unknown.stderr, /Unknown command/);
  assert.equal(f.connections(), 0); assert.equal(f.requests.length, 0); assert.equal(existsSync(state), false);
});

test("Kiro live CLI rejects missing portable-path option values before connecting", async t => {
  const f = await fixture(t);
  for (const flag of ["--fixture-root", "--tool-cwd"]) {
    const result = await f.run(join(f.directory, flag.slice(2) + ".json"), ["--workspace", ids.workspaceId, "--parent", ids.parentSessionId, "--task", ids.taskRef, flag]);
    assert.equal(result.code, 1); assert.match(result.stderr, new RegExp("Pass a value for " + flag));
  }
  assert.equal(f.connections(), 0); assert.equal(f.requests.length, 0);
});
