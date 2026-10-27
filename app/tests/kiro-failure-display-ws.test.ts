// Product WS display/read paths over a NEW synthetic native session. No live credentials or inference.
import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { WebSocket } from "ws";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import { startServer } from "../src/server/index.js";
import type { Scope, Session, Workspace } from "../src/shared/protocol.js";
import type { ChatMessage } from "../src/shared/agent.js";

test("formal WS snapshot, message.get and agent.original preserve only safe Kiro fields with session ownership", { timeout: 60000 }, async t => {
  const root = mkdtempSync(join(tmpdir(), "kiro-failure-display-ws-")), project = join(root, "project"); mkdirSync(project);
  const previousPi = process.env.AXIOM_PI_DIR;
  process.env.AXIOM_PI_DIR = join(root, "pi"); mkdirSync(process.env.AXIOM_PI_DIR);
  let ws: WebSocket | undefined, app: Awaited<ReturnType<typeof startServer>> | undefined;
  const starting = startServer({ root, port: 0 });
  const pending = new Map<string, { resolve: (value: unknown) => void; reject: (reason: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  t.after(async () => {
    ws?.terminate(); for (const entry of pending.values()) { clearTimeout(entry.timer); entry.reject(new Error("Fixture closed")); } pending.clear();
    app ??= await starting.catch(() => undefined); await app?.close();
    if (previousPi === undefined) delete process.env.AXIOM_PI_DIR; else process.env.AXIOM_PI_DIR = previousPi;
    rmSync(root, { recursive: true, force: true });
  });
  app = await starting;
  const workspace = app.store.execute({ requestId: randomUUID(), op: "workspace.open", params: { path: project, authorized: true } }) as Workspace;
  const createSession = () => app!.store.execute({ requestId: randomUUID(), op: "session.create", workspaceId: workspace.id }) as Session;
  const session = createSession(), other = createSession(), scope: Scope = { workspaceId: workspace.id, sessionId: session.id };
  const runId = randomUUID(), manager = SessionManager.create(project, join(root, "native-fixture"));
  manager.appendMessage({ role: "user", content: "OWNED_SYNTHETIC_INPUT", timestamp: 1 });
  const observedValidationReason = { token: "INVALID_MODEL_ID", contract: "unverified", source: "local-static-allowlist" } as const;
  const safe = { stage: "http", category: "validation", partial: false, status: 400, code: "ValidationException", requestId: randomUUID(), observedValidationReason };
  const native: AssistantMessage = { role: "assistant", content: [], api: "kiro-chat", provider: "kiro", model: "owned-fixture", timestamp: 1, stopReason: "error",
    errorMessage: "Kiro 请求验证失败，请检查消息、所选模型及 profile。",
    diagnostics: [{ type: "kiro-failure", timestamp: 1, details: { ...safe, conflict: false, bodyState: "json", body: "PRIVATE-BODY", headers: { authorization: "PRIVATE-HEADER" }, note: "PRIVATE-NOTE" } }],
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
  const owned = { ...native, axiomRunId: runId }, id = manager.appendMessage(owned), file = manager.getSessionFile(); assert.ok(file);
  // Only this new fixture DB is seeded; production code must resolve its ordinary session/file ownership.
  app.store.db.prepare("INSERT INTO agent_sessions(sessionId,file) VALUES(?,?) ON CONFLICT(sessionId) DO UPDATE SET file=excluded.file").run(session.id, file);
  const snapshots = new Map<string, unknown>();
  ws = new WebSocket(app.origin.replace("http:", "ws:") + "/ws", { headers: { Origin: app.origin } });
  ws.on("error", () => {});
  ws.on("message", raw => {
    const event = JSON.parse(raw.toString()) as { type?: string; scope?: string; data?: unknown; requestId?: string; ok?: boolean; error?: { code?: string } };
    if (event.type === "snapshot" && event.scope) snapshots.set(event.scope, event.data);
    if (event.type !== "receipt" || !event.requestId) return;
    const entry = pending.get(event.requestId); if (!entry) return;
    pending.delete(event.requestId); clearTimeout(entry.timer);
    if (event.ok) entry.resolve(event.data); else entry.reject(Object.assign(new Error("Formal operation rejected"), { code: event.error?.code }));
  });
  await once(ws, "open");
  const call = (op: string, params: Record<string, unknown> = {}, target: Scope = scope) => new Promise<unknown>((resolve, reject) => {
    const requestId = randomUUID(), timer = setTimeout(() => { pending.delete(requestId); reject(new Error("Formal receipt timeout")); }, 5000);
    pending.set(requestId, { resolve, reject, timer }); ws!.send(JSON.stringify({ requestId, op, params, ...target }));
  });
  const messagesScope = `messages:${scope.workspaceId}:${scope.sessionId}`;
  await call("subscribe", { scope: messagesScope });
  const snapshot = snapshots.get(messagesScope); assert.ok(Array.isArray(snapshot));
  const preview = snapshot.find((value: ChatMessage) => value.id === id); assert.ok(preview);
  const full = await call("message.get", { id }) as ChatMessage;
  const original = await call("agent.original") as ChatMessage[];
  for (const display of [preview, full, original.find(value => value.id === id)]) {
    assert.ok(display); assert.equal(display.runId, runId); assert.deepEqual(display.kiroFailure, safe);
    assert.doesNotMatch(JSON.stringify(display), /PRIVATE|diagnostics|authorization/);
  }
  await assert.rejects(call("message.get", { id }, { workspaceId: workspace.id, sessionId: other.id }), { code: "NOT_FOUND" });
  await assert.rejects(call("message.get", { id }, { workspaceId: randomUUID(), sessionId: session.id }), { code: "NOT_FOUND" });
});
