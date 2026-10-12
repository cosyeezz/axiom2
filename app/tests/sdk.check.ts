// Loopback protocol fixture, NOT a remote-provider/real-Agent acceptance test.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  existsSync,
  readFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Type } from "typebox";
import {
  createAgentSession,
  DefaultResourceLoader,
  defineTool,
  ModelRuntime,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";

const root = mkdtempSync(join(tmpdir(), "axiom-sdk-")),
  agentDir = join(root, "pi"),
  sessions = join(root, "sessions");
mkdirSync(agentDir);
mkdirSync(sessions);
let requestCount = 0,
  stall = false;
let accepted: (() => void) | undefined;
const seenToolNames: string[] = [];
const fixture = createServer(async (req, res) => {
  assert.equal(req.url, "/v1/chat/completions");
  assert.equal(req.headers.authorization, "Bearer sdk-fixture-key");
  let raw = "";
  for await (const chunk of req) raw += chunk;
  const body = JSON.parse(raw);
  seenToolNames.push(...body.tools.map((t: any) => t.function.name));
  requestCount++;
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
  });
  res.flushHeaders();
  if (stall) {
    accepted?.();
    return;
  }
  const chunk = (delta: unknown, finish_reason: string | null = null) =>
    res.write(
      `data: ${JSON.stringify({ id: "fixture-" + requestCount, object: "chat.completion.chunk", created: 1, model: "fixture", choices: [{ index: 0, delta, finish_reason }] })}\n\n`,
    );
  if (requestCount === 1) {
    chunk({
      role: "assistant",
      tool_calls: [
        {
          index: 0,
          id: "independent-tool-check",
          type: "function",
          function: {
            name: "delegate",
            arguments: JSON.stringify({
              context: "fixture",
              tasks: [{ task: "register-only" }],
            }),
          },
        },
      ],
    });
    chunk({}, "tool_calls");
  } else {
    chunk({ role: "assistant", content: "SDK fixture verified" });
    chunk({}, "stop");
  }
  res.end("data: [DONE]\n\n");
});
await new Promise<void>((resolve) => fixture.listen(0, "127.0.0.1", resolve));
const address = `http://127.0.0.1:${(fixture.address() as { port: number }).port}/v1`;
let session:
  | Awaited<ReturnType<typeof createAgentSession>>["session"]
  | undefined;
try {
  const runtime = await ModelRuntime.create({
    authPath: join(agentDir, "auth.json"),
    modelsPath: null,
    modelsStorePath: join(agentDir, "models-store.json"),
    allowModelNetwork: false,
    refreshOnCreate: false,
  });
  runtime.registerProvider("axiom-sdk-fixture", {
    api: "openai-completions",
    baseUrl: address,
    models: [
      {
        id: "fixture",
        name: "Fixture",
        reasoning: false,
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 16000,
        maxTokens: 1000,
      },
    ],
  });
  await runtime.login("axiom-sdk-fixture", "api_key", {
    prompt: async () => "sdk-fixture-key",
    notify: () => {},
  });
  assert.ok(
    (await runtime.listCredentials()).some(
      (c) => c.providerId === "axiom-sdk-fixture" && c.type === "api_key",
    ),
  );
  const model = runtime.getModel("axiom-sdk-fixture", "fixture")!;
  assert.ok(model);
  const settingsManager = SettingsManager.inMemory({
    retry: { enabled: false },
    compaction: { enabled: false },
  });
  const loader = new DefaultResourceLoader({
    cwd: root,
    agentDir,
    settingsManager,
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
  });
  await loader.reload();
  const text = Type.String({ minLength: 1, maxLength: 12000 });
  const checked = async () => ({
    content: [{ type: "text" as const, text: "test-only registration check" }],
    details: { fixture: true },
  });
  const tools = [
    defineTool({
      name: "delegate",
      label: "delegate",
      description: "Test-only independent delegation registration",
      parameters: Type.Object({
        context: text,
        tasks: Type.Array(
          Type.Object({ task: text, systemPrompt: Type.Optional(text) }),
          { minItems: 1, maxItems: 4 },
        ),
      }),
      execute: checked,
    }),
    defineTool({
      name: "append",
      label: "append",
      description: "Test-only independent append registration",
      parameters: Type.Object({
        taskId: text,
        text,
        mode: Type.Optional(
          Type.Union([Type.Literal("steer"), Type.Literal("followUp")]),
        ),
      }),
      execute: checked,
    }),
    defineTool({
      name: "cancel_task",
      label: "cancel_task",
      description: "Test-only independent cancellation registration",
      parameters: Type.Object({
        taskId: text,
        mode: Type.Optional(
          Type.Union([Type.Literal("summary"), Type.Literal("immediate")]),
        ),
        reason: Type.Optional(text),
      }),
      execute: checked,
    }),
    defineTool({
      name: "read_result",
      label: "read_result",
      description: "Test-only independent immutable result registration",
      parameters: Type.Object({ taskId: text, resultId: text }),
      execute: checked,
    }),
  ];
  const created = await createAgentSession({
    cwd: root,
    agentDir,
    modelRuntime: runtime,
    model,
    thinkingLevel: "off",
    resourceLoader: loader,
    settingsManager,
    sessionManager: SessionManager.create(root, sessions),
    tools: tools.map((t) => t.name),
    customTools: tools,
  });
  session = created.session;
  assert.deepEqual(session.getActiveToolNames().sort(), [
    "append",
    "cancel_task",
    "delegate",
    "read_result",
  ]);
  const events: string[] = [];
  session.subscribe((e) => events.push(e.type));
  await session.prompt("Run the local protocol fixture.", {
    expandPromptTemplates: false,
  });
  for (const event of [
    "message_start",
    "message_update",
    "message_end",
    "tool_execution_start",
    "tool_execution_end",
    "agent_end",
  ])
    assert.ok(events.includes(event), event);
  assert.ok(seenToolNames.includes("read_result"));
  assert.equal(requestCount, 2);
  const file = session.sessionFile!;
  assert.ok(existsSync(file));
  assert.ok(readFileSync(file, "utf8").includes("SDK fixture verified"));
  const context = SessionManager.open(file).buildSessionContext();
  assert.ok(context.messages.length >= 4);
  stall = true;
  const started = new Promise<void>((resolve) => {
    accepted = resolve;
  });
  const running = session.prompt("Stop this fixture request.", {
    expandPromptTemplates: false,
  });
  await Promise.race([
    started,
    new Promise((_, reject) =>
      setTimeout(
        () => reject(Error("SDK request did not start")),
        5000,
      ).unref(),
    ),
  ]);
  await session.abort();
  await running;
  assert.equal(session.isStreaming, false);
  assert.ok(
    session.messages.some(
      (m: any) => m.role === "assistant" && m.stopReason === "aborted",
    ),
  );
  await runtime.logout("axiom-sdk-fixture");
  await runtime.removeRuntimeApiKey("axiom-sdk-fixture");
  assert.ok(
    !(await runtime.listCredentials()).some(
      (c) => c.providerId === "axiom-sdk-fixture",
    ),
  );
  assert.ok(!(await runtime.getAvailable("axiom-sdk-fixture")).length);
  console.log(
    "PASS: isolated pi runtime, API-key login/logout, four independent tools, stream/tool events, explicit session-file restore, active abort. Loopback fixture only; remote/OAuth acceptance remains pending.",
  );
} finally {
  session?.dispose();
  fixture.closeAllConnections();
  await new Promise<void>((resolve) => fixture.close(() => resolve()));
  rmSync(root, { recursive: true, force: true });
}
