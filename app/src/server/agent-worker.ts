import { randomUUID } from "node:crypto";
import { join } from "node:path";
import {
  createAgentSession,
  DefaultResourceLoader,
  SettingsManager,
  type AgentSession,
} from "@earendil-works/pi-coding-agent";
import type { AgentInfo, Selection } from "../shared/agent.js";
import { ModelService } from "./model-service.js";
import { chatMessage, openTranscript, toolKey } from "./transcript.js";

export interface WorkerInput {
  root: string;
  cwd: string;
  file: string;
  modelsFile: string;
  runId: string;
  selection: Selection;
  prompt: string;
  projectTrusted: boolean;
}
let session: AgentSession | undefined,
  cancelled = false,
  started = false;
const send = (value: unknown) => {
  if (process.connected) process.send?.(value);
};
process.on("disconnect", () => {
  cancelled = true;
  void session?.abort().finally(() => process.exit(1));
  setTimeout(() => process.exit(1), 9000).unref();
});
process.on("message", (value: any) => {
  if (value.type === "stop") {
    cancelled = true;
    void session?.abort();
  }
  if (value.type === "start" && !started) {
    started = true;
    void run(value.input);
  }
});
function usage(): AgentInfo["usage"] {
  if (!session) return null;
  const stats = session.getSessionStats(),
    context = session.getContextUsage();
  return stats.tokens.total > 0
    ? {
        ...stats.tokens,
        cost: stats.cost > 0 ? stats.cost : null,
        context: context
          ? {
              tokens: context.tokens,
              window: context.contextWindow,
              percent: context.percent,
            }
          : null,
      }
    : null;
}
async function run(input: WorkerInput) {
  try {
    process.chdir(input.cwd);
    const runtime = await new ModelService(input.root).runtime(
      input.modelsFile,
    );
    const model = runtime.getModel(
      input.selection.provider,
      input.selection.id,
    );
    if (!model || runtime.getError()) throw Error();
    const settingsManager = SettingsManager.create(
      input.cwd,
      join(input.root, "pi"),
      { projectTrusted: input.projectTrusted },
    );
    // No speculative cache requests after a user stops or a worker finishes.
    settingsManager.applyOverrides({ cacheWarming: "off" });
    const loader = new DefaultResourceLoader({
      cwd: input.cwd,
      agentDir: join(input.root, "pi"),
      settingsManager,
    });
    await loader.reload();
    const result = await createAgentSession({
      cwd: input.cwd,
      agentDir: join(input.root, "pi"),
      modelRuntime: runtime,
      model,
      thinkingLevel: input.selection.thinking,
      settingsManager,
      resourceLoader: loader,
      sessionManager: openTranscript(input.file, input.cwd),
      // Add the platform shell without hiding authorized extension tools.
      ...(process.platform === "win32" &&
      !settingsManager.getSettings().defaultTools
        ? { tools: ["-bash", "+powershell"] }
        : {}),
    });
    session = result.session;
    await session.bindExtensions({
      mode: "rpc",
      onError: () =>
        send({
          type: "warning",
          text: "扩展执行失败；未转发可能含敏感内容的原始错误。",
        }),
    });
    await session.setModel(model);
    session.setThinkingLevel(input.selection.thinking);
    if (session.thinkingLevel !== input.selection.thinking) throw Error();
    send({
      type: "ready",
      environment: {
        cwd: input.cwd,
        tools: session.getActiveToolNames(),
        skills: loader.getSkills().skills.map((s) => s.name),
        extensions: result.extensionsResult.extensions.length,
        warnings: [
          ...(!input.projectTrusted
            ? ["项目本地扩展、技能与设置尚未授权，按 pi 非信任规则跳过。"]
            : []),
          ...(result.extensionsResult.errors.length
            ? ["部分扩展加载失败。"]
            : []),
        ],
      },
    });
    let currentId = "",
      firstUser = true;
    session.subscribe((event) => {
      if (event.type === "message_start") {
        send({ type: "phase", text: "" });
        currentId =
          event.message.role === "toolResult"
            ? `tool-${toolKey(input.runId, event.message.toolCallId)}`
            : event.message.role === "user" && firstUser
              ? input.runId
              : randomUUID();
        if (event.message.role === "user") firstUser = false;
        (event.message as any).axiomId = currentId;
      }
      if (
        event.type === "message_start" ||
        event.type === "message_update" ||
        event.type === "message_end"
      ) {
        const m = event.message as any;
        m.axiomId ??= currentId || randomUUID();
        m.axiomRunId = input.runId;
        const message = chatMessage(
          m,
          m.axiomId,
          event.type !== "message_end" && m.role === "assistant",
        );
        if (message) send({ type: "message", message });
      }
      if (
        event.type === "tool_execution_start" ||
        event.type === "tool_execution_update" ||
        event.type === "tool_execution_end"
      ) {
        send({
          type: "tool",
          id: toolKey(input.runId, event.toolCallId),
          name: event.toolName,
          status:
            event.type === "tool_execution_end"
              ? event.isError
                ? "failed"
                : "completed"
              : "running",
          output: {
            content: (event.type === "tool_execution_update"
              ? event.partialResult
              : event.type === "tool_execution_end"
                ? event.result
                : undefined
            )?.content
              ?.filter((c: any) => c.type === "text")
              .map((c: any) => ({ type: "text", text: c.text })),
          },
        });
      }
      if (event.type === "turn_end") send({ type: "usage", usage: usage() });
      if (event.type === "auto_retry_start")
        send({ type: "phase", text: `pi 正在重试（${event.attempt}）` });
      if (event.type === "compaction_start")
        send({ type: "phase", text: "pi 正在压缩上下文" });
    });
    if (!cancelled) {
      send({ type: "running" });
      await session.prompt(input.prompt, { expandPromptTemplates: true });
    }
    const last = [...session.messages]
      .reverse()
      .find((m) => m.role === "assistant");
    send({
      type: "done",
      status:
        cancelled || last?.stopReason === "aborted"
          ? "cancelled"
          : last?.stopReason === "error"
            ? "failed"
            : "completed",
      usage: usage(),
    });
  } catch {
    await session?.abort();
    send({
      type: "done",
      status: cancelled ? "cancelled" : "failed",
      error:
        "pi 初始化或执行失败；请检查模型、认证、项目资源与会话文件。原始错误未转发。",
    });
  } finally {
    await session?.extensionRunner.emit({
      type: "session_shutdown",
      reason: "quit",
    });
    session?.dispose();
    // Flush final IPC before disconnect; no idle process can retain stale credentials.
    if (process.connected)
      process.send?.({ type: "closed" }, () => {
        process.disconnect();
        process.exit(0);
      });
    else process.exit(0);
  }
}
