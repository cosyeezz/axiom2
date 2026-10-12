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
import { taskTools } from "./task-tools.js";
import { taskToolNames, type TaskTool } from "../shared/tasks.js";

export interface WorkerInput {
  root: string;
  cwd: string;
  file: string;
  modelsFile: string;
  runId: string;
  selection: Selection;
  prompt: string;
  projectTrusted: boolean;
  task?: { id: string; role: string; inputIds: string[] };
  notification?: { id: string; content: string };
}
let session: AgentSession | undefined,
  cancelled = false,
  started = false,
  accepting = false,
  summarize = false,
  summarizing = false,
  summaryMs = 60000,
  stopReason = "已请求停止";
const pendingCalls = new Map<
  string,
  { resolve: (data: unknown) => void; reject: (error: Error) => void }
>();
function callTask(
  name: TaskTool,
  id: string,
  params: unknown,
  signal?: AbortSignal,
) {
  return new Promise<unknown>((resolve, reject) => {
    const key = randomUUID();
    const abort = () => {
      pendingCalls.delete(key);
      reject(Error("工具调用已中断；受理状态需核实，勿重复委派。"));
    };
    signal?.addEventListener("abort", abort, { once: true });
    pendingCalls.set(key, {
      resolve: (data) => {
        signal?.removeEventListener("abort", abort);
        resolve(data);
      },
      reject: (error) => {
        signal?.removeEventListener("abort", abort);
        reject(error);
      },
    });
    if (signal?.aborted) abort();
    else send({ type: "task-call", key, name, callId: id, params });
  });
}
function delivered() {
  const ids =
    session?.sessionManager
      .getEntries()
      .flatMap((e) =>
        e.type === "custom_message" && (e.details as any)?.axiomInput
          ? [(e.details as any).axiomInput]
          : [],
      ) ?? [];
  if (ids.length) send({ type: "delivered", ids });
}
const send = (value: unknown) => {
  if (process.connected) process.send?.(value);
};
process.on("disconnect", () => {
  cancelled = true;
  void session?.abort().finally(() => process.exit(1));
  setTimeout(() => process.exit(1), 9000).unref();
});
process.on("message", (value: any) => {
  if (value.type === "task-reply") {
    const pending = pendingCalls.get(value.key);
    pendingCalls.delete(value.key);
    if (value.ok) pending?.resolve(value.data);
    else
      pending?.reject(Error(value.error || "子任务操作未完成；请核实状态。"));
  }
  if (
    value.type === "input" &&
    session &&
    accepting &&
    session.isStreaming &&
    !cancelled
  ) {
    void session
      .sendCustomMessage(
        {
          customType: value.notification ? "axiom-result" : "axiom-append",
          content: value.text,
          display: true,
          details: { axiomInput: value.id },
        },
        { deliverAs: value.mode === "followUp" ? "followUp" : "steer" },
      )
      .then(delivered)
      .catch(() => send({ type: "input-error", id: value.id }));
  }
  if (value.type === "stop") {
    if (!cancelled) {
      summarize = value.summary === true;
      summaryMs = value.summaryMs ?? 60000;
      stopReason = value.reason || stopReason;
    } else summarize = false;
    cancelled = true;
    accepting = false;
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
      extensionFactories: [
        {
          name: "axiom-summary-guard",
          factory: (pi) => {
            pi.on("tool_call", () =>
              summarizing
                ? {
                    block: true,
                    reason: "停止总结阶段禁止工具",
                    terminate: true,
                  }
                : undefined,
            );
          },
        },
      ],
      appendSystemPrompt: input.task
        ? [
            "你是独立子代理，只处理明确委派的背景和任务，不能递归委派。职责补充不覆盖项目规则、安全约束或预算。停止不代表文件回滚。交付须包含已有产出、未完成／未验证项和已知副作用。",
            input.task.role,
          ]
        : [
            "delegate、append、cancel_task、read_result 是独立的子任务工具。委派后继续独立工作，不轮询；完成通知到达后读取指定结果。并行 Agent 共享文件，必须分配不重叠范围。",
          ],
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
      customTools: input.task ? [] : taskTools(callTask),
      ...(input.task ? { excludeTools: [...taskToolNames] } : {}),
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
    if (!input.task)
      session.setActiveToolsByName([
        ...new Set([...session.getActiveToolNames(), ...taskToolNames]),
      ]);
    await session.setModel(model);
    session.setThinkingLevel(input.selection.thinking);
    if (session.thinkingLevel !== input.selection.thinking) throw Error();
    send({
      type: "ready",
      environment: {
        cwd: input.cwd,
        tools: session.getActiveToolNames(),
        skills: loader.getSkills().skills.map((s) => s.name),
        extensions: result.extensionsResult.extensions.filter(
          (e) => !e.path.includes("axiom-summary-guard"),
        ).length,
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
          event.message.role === "custom" &&
          (event.message.details as any)?.axiomInput
            ? `input-${(event.message.details as any).axiomInput}`
            : event.message.role === "toolResult"
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
      if (event.type === "turn_end") {
        delivered();
        send({ type: "usage", usage: usage() });
      }
      if (event.type === "message_end") {
        setImmediate(() => {
          delivered();
          if (
            event.message.role === "user" &&
            (event.message as any).axiomId === input.runId &&
            input.task
          )
            send({ type: "delivered", ids: input.task.inputIds });
        });
      }
      if (event.type === "auto_retry_start")
        send({ type: "phase", text: `pi 正在重试（${event.attempt}）` });
      if (event.type === "compaction_start")
        send({ type: "phase", text: "pi 正在压缩上下文" });
    });
    if (!cancelled) {
      accepting = true;
      send({ type: "running" });
      if (input.notification)
        await session.sendCustomMessage(
          {
            customType: "axiom-result",
            content: input.notification.content,
            display: true,
            details: { axiomInput: input.notification.id },
          },
          { triggerTurn: true },
        );
      else
        await session.prompt(input.prompt, {
          expandPromptTemplates: !input.task,
        });
    }
    accepting = false;
    delivered();
    if (cancelled && summarize && input.task) {
      await session.abort();
      session.clearQueue();
      summarizing = true;
      session.setActiveToolsByName([]);
      // Block extension attempts to re-enable tools during the summary as well.
      session.agent.state.tools = [];
      const off = session.subscribe((event) => {
        if (event.type === "turn_start") session!.agent.state.tools = [];
      });
      send({ type: "summarizing" });
      const timer = setTimeout(() => {
        void session?.abort();
      }, summaryMs);
      try {
        await session.prompt(
          `工作已停止：${stopReason}。仅根据已有上下文总结产出、未完成／未验证项和已知副作用。禁止工具，不要继续工作，不声称已回滚。`,
          { expandPromptTemplates: false },
        );
      } finally {
        clearTimeout(timer);
        off();
      }
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
