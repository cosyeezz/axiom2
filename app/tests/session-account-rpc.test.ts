import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WebSocket } from "ws";
import { startServer } from "../src/server/index.js";
import { ModelAccountService } from "../src/server/model-accounts.js";
import { ProviderUsageService } from "../src/server/provider-usage.js";
import { privateJson } from "../src/server/model-account-storage.js";
import type { SessionAccountUsage } from "../src/shared/session-account-usage.js";
import type { Reply, Scope, Session, Workspace } from "../src/shared/protocol.js";

test("real scoped cache RPC rejects account/refresh parameters, missing/foreign ownership and unauthorized workspaces before projecting; no generic agent command or upstream query", { timeout: 30000 }, async t => {
  const root = mkdtempSync(join(tmpdir(), "axiom-account-rpc-")), pi = join(root, "shared-pi"), project = join(root, "project"), other = join(root, "other");
  for (const dir of [pi, project, other]) mkdirSync(dir, { recursive: true });
  for (const file of ["auth.json", "models.json", "models-store.json"]) writeFileSync(join(pi, file), "{}");
  const keys = ["AXIOM_PI_DIR", "PI_CODING_AGENT_DIR", "AXIOM_EXECUTION_PROFILE", "AXIOM_MODEL_ACCOUNT_BINDINGS", "AXIOM_MODEL_PROVIDER", "PI_OFFLINE"];
  const previous = new Map(keys.map(key => [key, process.env[key]])); keys.forEach(key => { delete process.env[key]; });
  process.env.AXIOM_PI_DIR = pi; process.env.PI_CODING_AGENT_DIR = pi; process.env.PI_OFFLINE = "1";
  let app: Awaited<ReturnType<typeof startServer>> | undefined, ws: WebSocket | undefined;
  t.after(async () => { ws?.terminate(); await app?.close(); t.mock.restoreAll(); for (const [key, value] of previous) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } rmSync(root, { recursive: true, force: true }); });
  t.mock.method(globalThis, "fetch", async () => assert.fail("cache projection cannot make upstream network requests"));
  app = await startServer({ root, port: 0 });
  const socket = ws = new WebSocket(app.origin.replace("http", "ws") + "/ws", { headers: { Origin: app.origin } });
  await once(socket, "open");
  const request = (op: string, scope: Partial<Scope> = {}, params: Record<string, unknown> = {}): Promise<Reply> => {
    const requestId = randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { socket.off("message", receive); reject(Error(`timeout: ${op}`)); }, 5000);
      function receive(raw: Buffer) { const value = JSON.parse(raw.toString()); if (value.type !== "receipt" || value.requestId !== requestId) return; clearTimeout(timer); socket.off("message", receive); resolve(value); }
      socket.on("message", receive); socket.send(JSON.stringify({ requestId, op, ...scope, params }));
    });
  };
  const call = async <T>(op: string, scope: Partial<Scope>, params = {}) => { const reply = await request(op, scope, params); assert.ok(reply.ok, JSON.stringify(reply)); return reply.data as T; };
  const workspace = await call<Workspace>("workspace.open", {}, { path: project, authorized: true });
  const foreign = await call<Workspace>("workspace.open", {}, { path: other, authorized: true });
  const session = await call<Session>("session.create", { workspaceId: workspace.id });
  const scope = { workspaceId: workspace.id, sessionId: session.id };
  app.store.db.prepare("INSERT INTO agent_sessions(sessionId,selection) VALUES(?,?)").run(session.id, JSON.stringify({ provider: "openai-codex", id: "fixture", thinking: "off" }));
  app.agents.refresh(scope);
  const original = ModelAccountService.prototype.cachedBinding;
  const projected = t.mock.method(ModelAccountService.prototype, "cachedBinding", function (this: ModelAccountService, ...args: Parameters<typeof original>) { return original.apply(this, args); });
  t.mock.method(app.agents, "command", async () => assert.fail("cache RPC must not enter mutable agent commands"));
  const read = ProviderUsageService.prototype.read;
  t.mock.method(ProviderUsageService.prototype, "read", async () => assert.fail("cache eligibility must not call read(false)"));
  const op = "agent.accountUsage.cached";
  const valid = await request(op, scope); assert.ok(valid.ok, JSON.stringify(valid)); assert.equal(valid.data, null);
  assert.equal(projected.mock.callCount(), 1); assert.equal(projected.mock.calls[0].arguments[0].source, "next-execution");
  for (const params of [{ providerId: "openai-codex" }, { accountId: randomUUID() }, { refresh: false }, { credentialKey: "a".repeat(64) }, { extra: true }]) {
    const value = await request(op, scope, params); assert.equal(value.ok, false); assert.equal(value.error?.code, "INVALID_INPUT");
  }
  for (const missing of [{}, { workspaceId: workspace.id }, { sessionId: session.id }]) { const value = await request(op, missing); assert.equal(value.ok, false); assert.equal(value.error?.code, "INVALID_INPUT"); }
  const cross = await request(op, { ...scope, workspaceId: foreign.id }); assert.equal(cross.ok, false); assert.equal(cross.error?.code, "SCOPE_MISMATCH");
  app.store.db.prepare("UPDATE workspaces SET authorized=0 WHERE id=?").run(workspace.id);
  const forbidden = await request(op, scope); assert.equal(forbidden.ok, false); assert.equal(forbidden.error?.code, "AUTHORIZATION_REQUIRED");
  assert.equal(projected.mock.callCount(), 1, "invalid ownership/authorization never reaches account/cache metadata");
  app.store.db.prepare("UPDATE workspaces SET authorized=1 WHERE id=?").run(workspace.id);
  const provider = "openai-codex", auth = join(pi, "auth.json");
  privateJson(auth, { [provider]: { type: "oauth", access: "FIXTURE_RPC_ACCESS", refresh: "FIXTURE_RPC_REFRESH", expires: Date.now() + 86400000, email: "rpc@example.test" } });
  let seedQueries = 0;
  const seed = new ProviderUsageService(root, pi, async () => { seedQueries++; return { providerId: provider, status: "ready", updatedAt: Date.now(), metrics: [{ id: "balance", label: "剩余点数", kind: "balance", balance: "0" }] }; });
  // Explicit setup only: write a real service cache with an injected offline response;
  // the RPC remains forbidden from entering read(false), fetch, or authentication.
  await read.call(seed, provider); const savedAuth = readFileSync(auth, "utf8");
  const nonempty = await call<SessionAccountUsage>(op, scope);
  assert.equal(nonempty.source, "next-execution"); assert.equal(nonempty.providerId, provider);
  assert.equal(nonempty.account.label, "原有账号"); assert.equal(nonempty.account.email, "rpc@example.test");
  assert.deepEqual(nonempty.usage.metrics, [{ id: "balance", label: "剩余点数", kind: "balance", balance: "0" }]);
  assert.doesNotMatch(JSON.stringify(nonempty), /FIXTURE_RPC_|credentialKey|AXIOM_|Bearer/);
  assert.equal(readFileSync(auth, "utf8"), savedAuth); assert.equal(seedQueries, 1);
  assert.equal(projected.mock.callCount(), 2, "nonempty DTO crosses the real cache-only RPC without a provider query");
  t.mock.method(app.agents.reloads, "active", () => true);
  const pending = await request(op, scope); assert.ok(pending.ok); assert.equal(pending.data, null);
  assert.equal(projected.mock.callCount(), 2, "active but unproven execution cannot fall back to idle/default account");
});
