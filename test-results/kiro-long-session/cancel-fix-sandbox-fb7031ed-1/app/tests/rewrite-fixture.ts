import { createServer } from "node:http";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { startServer } from "../src/server/index.js";
import { running } from "../src/shared/agent.js";
import type { Session, Workspace, Scope } from "../src/shared/protocol.js";

export async function until(check: () => boolean, message: string, timeout = 25000) {
  const deadline = Date.now() + timeout;
  while (!check()) {
    if (Date.now() > deadline) throw new Error(message);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}
/** Real app + pi workers against a deterministic loopback provider; no external model access. */
export async function rewriteFixture(dev = false) {
  const root = mkdtempSync(join(tmpdir(), "axiom-rewrite-loopback-"));
  const project = join(root, "project"), pi = join(root, "pi");
  mkdirSync(project); mkdirSync(pi);
  const previous = process.env.AXIOM_PI_DIR; process.env.AXIOM_PI_DIR = pi;
  const requests: any[] = [];
  let stall = false;
  const provider = createServer(async (request, response) => {
    let raw = ""; for await (const chunk of request) raw += chunk;
    requests.push(JSON.parse(raw));
    response.writeHead(200, { "Content-Type": "text/event-stream" }); response.flushHeaders();
    if (stall) return;
    const chunk = (delta: unknown, finish_reason: string | null = null) => response.write(`data: ${JSON.stringify({
      id: randomUUID(), object: "chat.completion.chunk", created: 1, model: "rewrite", choices: [{ index: 0, delta, finish_reason }],
    })}\n\n`);
    chunk({ role: "assistant", content: `REWRITE_ANSWER_${requests.length}` }); chunk({}, "stop");
    response.write(`data: ${JSON.stringify({ id: "usage", object: "chat.completion.chunk", model: "rewrite", choices: [],
      usage: { prompt_tokens: 80, completion_tokens: 10, total_tokens: 90 } })}\n\n`);
    response.end("data: [DONE]\n\n");
  });
  await new Promise<void>((resolve) => provider.listen(0, "127.0.0.1", resolve));
  writeFileSync(join(pi, "models.json"), JSON.stringify({ providers: { "rewrite-fixture": {
    api: "openai-completions", baseUrl: `http://127.0.0.1:${(provider.address() as any).port}/v1`,
    models: [{ id: "rewrite", name: "Rewrite Fixture", input: ["text", "image"], contextWindow: 32000, maxTokens: 1000 }],
  } } }));
  writeFileSync(join(pi, "auth.json"), JSON.stringify({ "rewrite-fixture": { type: "api_key", key: "loopback-fixture" } }));
  writeFileSync(join(pi, "settings.json"), JSON.stringify({ retry: { enabled: false }, compaction: { enabled: false } }));
  const app = await startServer({ root, port: 0, dev });
  const workspace = app.store.execute({ op: "workspace.open", requestId: randomUUID(), params: { path: project, authorized: true } }) as Workspace;
  const session = app.store.execute({ op: "session.create", requestId: randomUUID(), workspaceId: workspace.id }) as Session;
  const scope = { workspaceId: workspace.id, sessionId: session.id };
  const selection = { provider: "rewrite-fixture", id: "rewrite", thinking: "off" as const };
  const call = (op: string, params: Record<string, unknown> = {}, target: Scope = scope, requestId = randomUUID()) => app.tasks.command({ op, params, ...target, requestId });
  await call("agent.model", { selection });
  const idle = (target = scope) => until(() => !running(app.agents.info(target).run) && !app.agents.active(target), "execution did not settle");
  return { app, root, project, scope, selection, requests, call, idle, stall: (value: boolean) => { stall = value; },
    close: async () => {
      await app.close(); provider.closeAllConnections(); await new Promise<void>((resolve) => provider.close(() => resolve()));
      if (previous === undefined) delete process.env.AXIOM_PI_DIR; else process.env.AXIOM_PI_DIR = previous;
      rmSync(root, { recursive: true, force: true });
    } };
}
