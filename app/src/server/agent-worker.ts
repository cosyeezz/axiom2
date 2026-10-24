import "./pi-settings-storage.js";
import { ModelLatency, latencyError } from "./model-latency.js";
import { configureModelNetwork, defaultModelsPath, toolEnvironment } from "./integrations/model-proxy-env.js";
import { capabilityExtensions, capabilityRuntime, discoverCapabilities, type CapabilityRuntime } from "./capability-resources.js";
import { environmentResourceOptions } from "./environment-resources.js";
import { runtimeEnvironment } from "./session-environment.js";
import { applySkillDiscovery } from "./skill-discovery.js";
import { resourceSnapshot } from "./reload-resources.js";
import { resumeReloadedSession } from "./reload-resume.js";
import type { ResourceSnapshot } from "../shared/reload.js";
import { performance } from "node:perf_hooks";
import { acceptsLease, awaitExecutionPermit, ExecutionPermitDeniedError, leaseSender, sameInstance, sameLease, workerInstance, type LeaseRef } from "./execution-protocol.js";
import { randomUUID } from "node:crypto";
import { ensureTopicSnapshot, injectTopicSnapshot } from "./memory-topics.js";
import type { MemoryTopicSnapshot } from "../shared/memory-tree.js";
import { memoryQueryTool, memoryDetailTool } from "./memory-tool.js";
import { guardMemoryEdit } from "./memory-detail.js";
import { pendingMemoryRead, recordMemoryRead } from "./memory-recovery.js";
import { within } from "./memory-files.js";
import { memoryRoot } from "./memory-storage.js";
import { PersistedInputCursor } from "./agents/persisted-inputs.js";
import { nativeInputs, nativeQueuedMessages, recallNativeInputs, retainedInput } from "./agents/native-queue.js";
import { queueTaskNotifications } from "./agents/task-notifications.js";
import { join, resolve, dirname } from "node:path";
import { applyOpenCliEnvironment } from "./integrations/opencli-runtime.js";
import { createInstalledResourceLoader } from "./installed-resource-loader.js";
import {
  createAgentSession,
  createBashToolDefinition,
  createPowerShellToolDefinition,
  type BashSpawnHook,
  SettingsManager,
  resizeImage,
  type AgentSession,
  type BoundaryState,
  type BoundaryResult,
  type CompactionEntry,
  type CompactionEntryDraft,
} from "@earendil-works/pi-coding-agent";
import type { AgentInfo, Selection, RetryInfo, RunPhase } from "../shared/agent.js";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { getCurrentSystemMessage, getSystemMessageText } from "@earendil-works/pi-ai";
import { executionOutcome } from "./execution-outcome.js";
import { isResumeControl, omitResumeControls, resumeSession } from "./resume-session.js";
import { ModelService } from "./model-service.js";
import { rtkExtension } from "./integrations/rtk-runtime.js";
import { openCliResources } from "./integrations/opencli-resources.js";
import { reaResources } from "./integrations/rea-resources.js";
import { contextUsage } from "./context-usage.js";
import { lastRequestUsage } from "./request-usage.js";
import { CompressionMemory } from "./compression-memory.js";
import { compressionError } from "./compression-error.js";
import { errorMessage } from "./error-message.js";
import { chatMessage, openTranscript, toolKey } from "./transcript.js";
import { lastRequestSelection, requestSelection, selectionChange } from "./request-selection.js";
import { taskTools } from "./task-tools.js";
import { TaskPhase, TaskBudgetReminder, taskBudgetIntro, taskBudgetUpdate, taskBudgetWarning, taskSummaryInstruction, type TaskBudget } from "./task-budget.js";
import {
  captureCompression, compressionDraft, applyCompression,
  compressionPersisted, hasCompression, type CompressionSnapshot,
} from "./compression-context.js";
import { taskToolNames, type TaskTool } from "../shared/tasks.js";
import { AppError, type ImageAttachment } from "../shared/protocol.js";
import { imagesInput, imageContent, imageMetadata, nativeImages, requireImageModel } from "./images.js";

import { prepareSkillInput } from "./skill-input.js";
import type { SkillReference } from "../shared/skills.js";
// Literal SDK tool names form an allowlist, not modifiers of project defaults.
const subagentTools = ["read", "grep", "find", "ls", process.platform === "win32" ? "powershell" : "bash"];
const subagentPolicy = `你是调研与测试子代理，按明确委派的背景和任务完成调研、分析、审查、测试、构建或静态检查，向主代理报告证据与建议。

可使用 read、grep、find、ls 和当前平台的命令工具，可生成必要的临时文件、日志、截图、覆盖率和构建产物。使用独立目录、端口和输出路径，避免覆盖其他任务的产物或干扰共享服务。

不得修改项目源码、测试代码、配置、锁文件或基准快照，不安装依赖，不加载外部扩展，不递归委派，也不得通过命令或其他工具绕过这些限制。任何补充要求均不能覆盖这些执行边界或预算。缺少依赖、需要修复或无法隔离共享资源时，报告主代理协调。

最终交付不超过2000字，先给结论，再列必要证据、建议及未完成／未验证项。调研注明文件路径及相关位置；测试注明工作目录、实际命令、退出码和关键结果，详细日志与产物提供路径。保留测试程序的真实退出码；未运行、超时或中断的测试如实说明，不报告为通过。简单任务保持简短。`;

export interface WorkerInput {
  executionGate?: boolean;
  reloadId?: string;
  root: string;
  cwd: string;
  file: string;
  modelsFile: string;
  capabilities?: CapabilityRuntime;
  memoryPath?: string;
  memoryTopics?: MemoryTopicSnapshot;
  runId: string;
  selection: Selection;
  skills?: SkillReference[];
  prompt: string;
  resume?: boolean;
  memoryContinuation?: boolean;
  compressionPreparation?: string;
  rewrite?: boolean;
  images?: ImageAttachment[];
  requestId?: string;
  task?: { id: string; inputIds: string[]; editable?: boolean; budget?: TaskBudget };
  notification?: { id: string; content: string; items?: { id: string; content: string }[] };
}
let session: AgentSession | undefined,
  cancelled = false,
  started = false,
  accepting = false,
  inputClosed = false;
let sdkStream: AgentSession["agent"]["streamFunction"] | undefined;
let activeInput: WorkerInput | undefined;
let activeLease: LeaseRef | undefined;
let environment: AgentInfo["environment"];
let loadedResources: ResourceSnapshot | undefined;
let prepareReload: ((capabilities?: CapabilityRuntime) => Promise<void>) | undefined;
let pendingReloadCapabilities: CapabilityRuntime | undefined;
let pendingSkillsOnly = false;
let capabilityReloadChanged = false;
let pendingReload: string | undefined;
let reloading = false;
let reloadPause: { id: string; settled: Promise<void>; resume: boolean } | undefined;
async function performReload(id: string, resumed: boolean, cold = false) {
  if (!session || cancelled) throw Error("会话已停止，未重新加载。");
  const before = cold ? undefined : loadedResources;
  send({ type: "reload-stage", id, stage: "reloading" });
  reloading = true;
  try {
    const capabilities = pendingReloadCapabilities, skillsOnly = pendingSkillsOnly;
    pendingReloadCapabilities = undefined;
    pendingSkillsOnly = false;
    if (capabilities) capabilityReloadChanged = true;
    if (skillsOnly) {
      if (!capabilities || !activeInput?.capabilities || activeInput.task) throw Error("当前会话无法调整技能自动发现。");
      applySkillDiscovery(session, activeInput.cwd, join(activeInput.root, "pi"), capabilities);
      activeInput.capabilities.selection = { ...activeInput.capabilities.selection, skills: capabilities.selection.skills };
      activeInput.capabilities.skillPaths = capabilities.skillPaths;
    } else {
      await prepareReload?.(capabilities);
      await session.reload();
      if (activeInput?.task) session.setActiveToolsByName(taskPhase.stage === "summary" ? [] : subagentTools);
      else session.setActiveToolsByName([...new Set([...session.getActiveToolNames(), ...taskToolNames, "memory_query", "memory_detail"])]);
    }
    if (cancelled) throw Error("会话已停止，重载结果待确认。");
    send({ type: "reload-stage", id, stage: "comparing" });
    const snapshot = () => {
      const next = resourceSnapshot(session!, activeInput?.capabilities);
      return skillsOnly && before ? { ...before, skills: next.skills } : next;
    };
    loadedResources = snapshot();
    environment = runtimeEnvironment(session, activeInput!);
    const report = () => {
      // A resumed prompt may finish native MCP tool discovery before the
      // continuation is accepted. Publish its current declarations, not the
      // earlier background-connection snapshot.
      loadedResources = snapshot();
      environment = runtimeEnvironment(session!, activeInput!);
      send({ type: "reload-result", id, ok: true, before, after: loadedResources, warnings: environment!.warnings, environment, resumed });
    };
    if (!resumed) report();
    return report;
  } catch (error) {
    send({ type: "reload-result", id, ok: false, error: errorMessage(error, "重载失败；未恢复执行，旧扩展不保证可继续使用。") });
    throw error;
  } finally { reloading = false; }
}
let unsubscribeRun: (() => void) | undefined;
let budgetReminder: TaskBudgetReminder | undefined;
let announcedBudget = "";
const budgetKey = (budget: TaskBudget) => JSON.stringify([budget.revision ?? 0, budget.workMs, budget.deadlineAt]);
function announceTaskBudget() {
  const budget = activeInput?.task?.budget;
  if (!budget || !session || !accepting || cancelled || inputClosed || taskPhase.stage !== "work" || announcedBudget === budgetKey(budget)) return;
  announcedBudget = budgetKey(budget);
  // Share the native FIFO with reminders and appended requirements. Snapshot
  // once; never rewrite a previous request when the clock or revision changes.
  void session.sendCustomMessage({ customType: "axiom-budget", display: false,
    content: taskBudgetUpdate(budget), details: { runId: activeInput!.runId, revision: budget.revision },
  }, { deliverAs: "steer", ...(session.isStreaming ? {} : { triggerTurn: false }) }).catch(() => {
    send({ type: "warning", text: "子任务预算更新未确认送达；截止时间仍然有效。" });
  });
}
let taskPhase = new TaskPhase();
let handledTaskTransition = 0;
let phaseAbort: Promise<void> = Promise.resolve();
let resumeSubmission: { transition: number; accepted: boolean; uncertain: boolean; ready: Promise<void>; confirm: () => void } | undefined;
function changeTaskStage(stage: "work" | "summary") {
  if (cancelled || inputClosed || !taskPhase.change(stage)) return;
  accepting = false;
  budgetReminder?.dispose();
  phaseAbort = session?.abort() ?? Promise.resolve();
  // The serial run loop observes rejection; don't leave an unhandled promise.
  void phaseAbort.catch(() => {});
}
function applyTaskBudget(value: TaskBudget) {
  const previous = activeInput?.task?.budget;
  if (!previous || (value.revision ?? 0) < (previous.revision ?? 0)) return false;
  activeInput!.task!.budget = { ...previous, ...value };
  return true;
}
function canAcceptInput() {
  return Boolean(session && accepting && !cancelled && !inputClosed &&
    (session.isStreaming || (activeInput?.task && taskPhase.stage === "work" && taskPhase.revision !== handledTaskTransition && session.isIdle)));
}
async function shutdown() {
  cancelled = true;
  budgetReminder?.dispose();
  await session?.abort();
  await session?.extensionRunner.emit({ type: "session_shutdown", reason: "quit" });
  session?.dispose();
  if (process.connected) process.send?.({ type: "closed", runId: activeInput?.runId, lease: activeLease }, () => process.exit(0));
  else process.exit(0);
}
// Decode and enqueue in IPC arrival order; text must not overtake an earlier image.
let inputQueue: Promise<void> = Promise.resolve();
const pendingInputs = new Map<string, { mode: "steer" | "followUp" }>();
let lastQueue = "";
function publishQueue() {
  const value = { type: "queue", queue: [...pendingInputs].map(([id, value]) => ({ id, ...value })),
    native: session ? nativeInputs(session) : [] };
  const key = JSON.stringify(value);
  if (key === lastQueue) return;
  lastQueue = key;
  send(value);
}
type CompressionApply = { snapshot: CompressionSnapshot; entry: CompactionEntry };
const compressionSnapshots = new Set<string>();
const compressionMemory = new CompressionMemory();
const compressionApplies = new Map<string, CompressionApply>();
const compressionCommitting = new Map<string, CompactionEntryDraft>();
const compressionCancels = new Set<string>();
let compressionClosed = false;
let compressionPreparationOnly = false;

function acknowledgeCompression(id: string) {
  const draft = compressionCommitting.get(id);
  if (!draft || !session) return;
  const committed = session.sessionManager.getBranch().find((entry) =>
    entry.type === "compaction" &&
    (entry.details as { axiomCompressionId?: string } | undefined)?.axiomCompressionId === id);
  const ok = committed?.type === "compaction" && committed.summary === draft.summary &&
    committed.firstKeptEntryId === (draft.firstKeptEntryId ?? committed.id) &&
    compressionPersisted(session.sessionManager, id);
  compressionCommitting.delete(id);
  send({ type: "compression-applied", id, ok: Boolean(ok) });
  if (ok) send({ type: "usage", usage: usage() });
  if (compressionCancels.delete(id))
    send({ type: "compression-cancelled", id, applied: hasCompression(session.sessionManager, id) });
}

// Invoked only from actionable extension boundaries or before/after prompt().
// No summary request is awaited here: IPC receipt merely queues plain data.
function compressionBoundary(event?: BoundaryState): BoundaryResult | undefined {
  if (!session || cancelled || compressionClosed) return;
  for (const id of [...compressionCommitting.keys()]) acknowledgeCompression(id);
  for (const id of compressionCancels) {
    compressionCancels.delete(id);
    send({ type: "compression-cancelled", id, applied: hasCompression(session.sessionManager, id) });
  }
  for (const id of compressionSnapshots) {
    try {
      if (activeInput?.memoryPath) {
        if (event) {
          const continuation = compressionMemory.boundary(id, event);
          if (continuation) return continuation;
        }
        if (!compressionMemory.sent(id) || !event || event.outcome !== "completed") continue;
      }
      compressionSnapshots.delete(id);
      compressionMemory.delete(id);
      send({ type: "compression-snapshot", id, snapshot: captureCompression(session.sessionManager) });
    } catch (error) {
      compressionSnapshots.delete(id);
      compressionMemory.delete(id);
      send({ type: "compression-snapshot", id, ok: false, error: compressionError(error) });
    }
  }
  // Multiple compactions or context edits in a single boundary would invalidate
  // one another. Preserve other extensions' proposals, but refuse our apply.
  let entries = event?.entries ?? [];
  for (const [id, request] of compressionApplies) {
    // Recovery may still edit context after an unsuccessful turn. Keep the
    // request until a completed boundary or the idle ownership handoff.
    if (event && event.outcome !== "completed") continue;
    compressionApplies.delete(id);
    try {
      if (request.snapshot?.header?.id !== session.sessionManager.getHeader()?.id) throw Error();
      if (hasCompression(session.sessionManager, id)) {
        const ok = compressionPersisted(session.sessionManager, id);
        send({ type: "compression-applied", id, ok });
        if (ok) send({ type: "usage", usage: usage() });
        continue;
      }
      if (entries.length) throw Error("此安全边界已有其他扩展的上下文修改。");
      const draft = compressionDraft(session.sessionManager, request.snapshot, request.entry, id);
      if (!event) {
        applyCompression(session.sessionManager, request.snapshot, request.entry, id);
        session.refreshContext();
        send({ type: "compression-applied", id, ok: true });
        send({ type: "usage", usage: usage() });
      } else {
        compressionCommitting.set(id, draft);
        entries = [...entries, draft];
        // entry_appended acknowledges persistence. Public turn_end/agent_settled
        // detect a discarded draft only after native dispatch has completed.
      }
    } catch (error) {
      send({ type: "compression-applied", id, ok: false, error: compressionError(error) });
    }
  }
  return event ? { entries } : undefined;
}

function closeCompressionRequests() {
  compressionClosed = true;
  for (const id of [...compressionCommitting.keys()]) acknowledgeCompression(id);
  // Settlement hands these requests back to the coordinator; it is not a
  // snapshot/apply failure. Only uncommitted requests can be deferred.
  for (const id of compressionSnapshots) send(activeInput?.memoryPath && compressionMemory.sent(id)
    ? { type: "compression-snapshot", id, ok: false, error: "未到达可用压缩安全点；未生成摘要。" }
    : { type: "compression-deferred", id });
  compressionMemory.clear();
  for (const id of compressionApplies.keys()) send({ type: "compression-deferred", id });
  compressionSnapshots.clear();
  compressionApplies.clear();
  for (const id of compressionCancels)
    send({ type: "compression-cancelled", id,
      applied: session ? hasCompression(session.sessionManager, id) : false });
  compressionCancels.clear();
}

const pendingCalls = new Map<
  string,
  { resolve: (data: unknown) => void; reject: (error: Error) => void }
>();
function callTask(
  name: TaskTool | "memory_query",
  id: string,
  params: unknown,
  signal?: AbortSignal,
) {
  return new Promise<unknown>((resolve, reject) => {
    const send = leaseSender(activeLease, activeInput?.runId);
    const key = randomUUID();
    const abort = () => {
      pendingCalls.delete(key);
      if (name === "memory_query") send({ type: "memory-cancel", key });
      reject(Error("工具调用已中断，不会自动重新委派。"));
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
    else send({ type: name === "memory_query" ? "memory-call" : "task-call", key, name, callId: id, params });
  });
}
let deliveryCursor = new PersistedInputCursor();
const notificationIds = new Set<string>();
const persistedNotifications = new Set<string>();
function delivered() {
  if (!activeInput) return;
  try {
    const { ids, notifications } = deliveryCursor.read(activeInput.file, (messageIds) => {
      if (messageIds.length) send({ type: "messages-persisted", ids: messageIds });
    });
    for (const id of notifications) persistedNotifications.add(id);
    if (ids.length) send({ type: "delivered", ids });
  } catch {
    // A failed read or incomplete/corrupt transcript cannot confirm delivery.
    // Settlement reconciles from disk; the cursor does not advance on failure.
  }
}
const send = (value: unknown) => leaseSender(activeLease, activeInput?.runId)(value);
process.on("disconnect", () => {
  cancelled = true;
  budgetReminder?.dispose();
  void session?.abort().finally(() => process.exit(1));
  setTimeout(() => process.exit(1), 9000).unref();
});
process.on("message", (value: any) => {
  if (value.type === "shutdown") {
    if (sameInstance(value.instance) || !value.lease || !activeLease || sameLease(value.lease, activeLease)) void shutdown();
    return;
  }
  if (value.type === "start" && !acceptsLease(value.lease)) return;
  if (value.type !== "start" && (value.runId !== activeInput?.runId || workerInstance && !sameLease(value.lease, activeLease))) return;
  if (value.type === "reload" && typeof value.id === "string") {
    if (cancelled || inputClosed || pendingReload || reloadPause) send({ type: "reload-result", id: value.id, ok: false, error: "会话正在结束或已有重载请求，请稍后重试。" });
    else { pendingReload = value.id; pendingReloadCapabilities = activeInput?.task ? undefined : value.capabilities; pendingSkillsOnly = value.kind === "skills"; }
    return;
  }
  if ((value.type === "budget" || value.type === "summarize") && activeInput?.task?.budget) {
    const budget: TaskBudget = { ...activeInput.task.budget, workMs: value.workMs,
      deadlineAt: value.deadlineAt, revision: value.revision ?? 0,
      workStartedAt: value.workStartedAt, summaryDeadlineAt: value.summaryDeadlineAt };
    if (!applyTaskBudget(budget)) return;
    if (value.type === "summarize") changeTaskStage("summary");
    else {
      announceTaskBudget();
      if (taskPhase.stage === "work") budgetReminder?.update(budget);
    }
    return;
  }
  if (typeof value.id === "string" && value.id) {
    if (value.type === "compression-cancel") {
      compressionSnapshots.delete(value.id);
      compressionMemory.delete(value.id);
      if (compressionPreparationOnly && activeInput?.compressionPreparation === value.id) {
        cancelled = true;
        void session?.abort();
      }
      compressionApplies.delete(value.id);
      if (compressionCommitting.has(value.id) || (!session && !compressionClosed)) {
        compressionCancels.add(value.id);
      } else {
        send({ type: "compression-cancelled", id: value.id,
          applied: session ? hasCompression(session.sessionManager, value.id) : false });
      }
      return;
    }
    if (value.type === "compression-snapshot") {
      if (compressionClosed || cancelled) send({ type: "compression-deferred", id: value.id });
      else {
        compressionSnapshots.add(value.id);
        if (activeInput?.memoryPath) compressionMemory.request(value.id);
      }
      return;
    }
    if (value.type === "compression-apply") {
      if (compressionClosed || cancelled) send({ type: "compression-deferred", id: value.id });
      else if (!compressionCommitting.has(value.id)) {
        compressionApplies.set(value.id, { snapshot: value.snapshot, entry: value.entry });
        send({ type: "compression-queued", id: value.id });
      }
      return;
    }
  }
  if (value.type === "task-reply") {
    const pending = pendingCalls.get(value.key);
    pendingCalls.delete(value.key);
    if (value.ok) pending?.resolve(value.data);
    else
      pending?.reject(Error(value.error || "子任务操作未完成。"));
  }
  if (value.type === "recall") {
    const ids = new Set<string>(value.ids);
    const removed = [...pendingInputs.keys()].filter((id) => ids.has(id));
    for (const id of removed) {
      pendingInputs.delete(id);
      send({ type: "input-accepted", id }); // A withdrawn accepted IPC input must still settle its submit receipt.
    }
    if (session) removed.push(...recallNativeInputs(session, ids));
    publishQueue();
    send({ type: "recalled", key: value.key, ids: [...new Set(removed)] });
    return;
  }
  if (value.type === "input") {
    if (cancelled || inputClosed) {
      for (const item of value.notifications ?? [{ id: value.id }]) send({ type: "input-error", id: item.id });
      return;
    }
    if (!value.notification) {
      pendingInputs.set(value.id, { mode: value.mode === "followUp" ? "followUp" : "steer" });
      if (value.budget) applyTaskBudget(value.budget);
    }
    publishQueue();
    inputQueue = inputQueue.then(async () => {
      // Preparation must finish before aborting a summary or exposing work tools.
      const images = value.notification ? [] : imagesInput(value.images);
      const prepared = value.notification ? [] : await prepareImages(images);
      if (!value.notification && !pendingInputs.has(value.id)) return;
      if (!value.notification && session) requireImageModel(session.model, images);
      if (!value.notification && activeInput?.task && taskPhase.stage === "summary" &&
          !cancelled && !inputClosed) {
        if (activeInput.task.budget?.summaryDeadlineAt)
          throw new AppError("INPUT_EXPIRED", "追加输入准备期间工作时限已到；未恢复工作。");
        changeTaskStage("work");
        let confirm!: () => void;
        const ready = new Promise<void>(resolve => { confirm = resolve; });
        resumeSubmission = { transition: taskPhase.revision, accepted: false, uncertain: false, ready, confirm };
      }
      while (!accepting && !inputClosed && !cancelled)
        await new Promise((resolve) => setTimeout(resolve, 10));
      if (!value.notification && !pendingInputs.has(value.id)) return;
      if (!session || !canAcceptInput())
        throw Error("输入未进入安全交付边界");
      if (value.notification) {
        const before = notificationIds.size;
        await queueTaskNotifications(session, value.notifications ?? [{ id: value.id, content: value.text }],
          notificationIds, persistedNotifications, () => accepting && !cancelled && !!session?.isStreaming, send);
        if (notificationIds.size > before) compressionPreparationOnly = false;
        delivered();
        return;
      }
      requireImageModel(session.model, images);
      const skillInput = prepareSkillInput(value.text, value.skills, session);
      // Recall can run during image decoding. Its tombstone wins before enqueue.
      if (!value.notification && !pendingInputs.has(value.id)) return;
      // Never append an unconsumed custom message after prompt() settles or stop.
      if (!canAcceptInput())
        throw Error("输入未进入安全交付边界");
      // Claim before SDK submission: after this point a local pending entry is
      // no longer evidence that the input can safely be returned as a draft.
      pendingInputs.delete(value.id);
      const submissionTransition = taskPhase.revision;
      const budget = activeInput?.task?.budget;
      if (budget?.summaryDeadlineAt)
        throw new AppError("INPUT_EXPIRED", "追加输入准备期间工作时限已到；未恢复工作。");
      const prompt = budget ? `${taskBudgetUpdate(budget)}\n\n${skillInput.prompt}` : skillInput.prompt;
      if (budget) announcedBudget = budgetKey(budget);
      try {
        await session.sendCustomMessage(
        {
          customType: value.notification ? "axiom-result" : "axiom-append",
          content: prepared.length ? imageContent(prompt, prepared) : prompt,
          display: true,
          details: { axiomInput: value.id, images: imageMetadata(images),
            ...(skillInput.metadata ? { skillInput: skillInput.metadata } : {}),
            ...(budget ? { axiomBudget: { runId: activeInput!.runId, revision: budget.revision ?? 0 }, taskInputText: skillInput.prompt } : {}) },
        },
        { deliverAs: value.mode === "followUp" ? "followUp" : "steer",
          ...(session.isStreaming ? {} : { triggerTurn: false }) },
        );
      } catch (error) {
        let retained: boolean | undefined;
        try { retained = retainedInput(session, value.id); } catch { /* Unknown is never replayed or treated as safely rejected. */ }
        if (retained !== true) {
          if (retained === undefined) {
            compressionPreparationOnly = false;
            if (resumeSubmission?.transition === submissionTransition) resumeSubmission.uncertain = true;
            send({ type: "input-error", id: value.id, uncertain: true, error: "追加输入送达未确认；未自动重发。" });
            publishQueue();
            return;
          }
          throw error;
        }
      }
      if (budget && taskPhase.stage === "work") budgetReminder?.update(budget);
      compressionPreparationOnly = false;
      if (resumeSubmission?.transition === submissionTransition) {
        resumeSubmission.accepted = true;
        resumeSubmission.confirm();
      }
      send({ type: "input-accepted", id: value.id });
      publishQueue();
      delivered();
    }).catch((error) => {
      pendingInputs.delete(value.id);
      publishQueue();
      for (const item of value.notifications ?? [{ id: value.id }]) send({ type: "input-error", id: item.id,
        ...(error instanceof AppError ? { error: error.message } : {}) });
    });
  }
  if (value.type === "start" && !started) {
    started = true;
    activeInput = value.input;
    activeLease = value.lease ? Object.freeze({ ...value.lease }) : undefined;
    cancelled = false;
    accepting = false;
    inputClosed = false;
    pendingReload = undefined;
    pendingReloadCapabilities = undefined;
    pendingSkillsOnly = false;
    capabilityReloadChanged = false;
    reloadPause = undefined;
    compressionClosed = false;
    compressionPreparationOnly = Boolean(activeInput?.compressionPreparation);
    if (activeInput?.compressionPreparation) {
      compressionSnapshots.add(activeInput.compressionPreparation);
      compressionMemory.request(activeInput.compressionPreparation);
    }
    taskPhase = new TaskPhase();
    announcedBudget = "";
    if (activeInput?.task?.budget?.summaryDeadlineAt) taskPhase.change("summary");
    handledTaskTransition = 0;
    phaseAbort = Promise.resolve();
    resumeSubmission = undefined;
    lastQueue = "";
    inputQueue = Promise.resolve();
    pendingInputs.clear();
    budgetReminder?.dispose();
    budgetReminder = new TaskBudgetReminder((deadlineAt) => {
      if (!session || !accepting || inputClosed || cancelled || taskPhase.stage !== "work" || !session.isStreaming) return false;
      void session.sendCustomMessage({ customType: "axiom-budget-warning", display: false,
        content: taskBudgetWarning(deadlineAt), details: { runId: activeInput!.runId, deadlineAt },
      }, { deliverAs: "steer" }).catch(() => {
        send({ type: "warning", text: "子任务预算提醒未确认送达；截止时间仍然有效。" });
      });
      return true;
    });
    if (activeInput?.task?.budget) budgetReminder.update(activeInput.task.budget);
    if (value.input.task?.editable)
      for (const id of value.input.task.inputIds) pendingInputs.set(id, { mode: "steer" });
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
        lastRequest: lastRequestUsage(session.sessionManager),
        context: contextUsage(session.sessionManager, context
          ? {
              tokens: context.tokens,
              window: context.contextWindow,
              percent: context.percent,
            }
          : null),
      }
    : null;
}
async function prepareImages(images: ImageAttachment[]) {
  const prepared: ImageAttachment[] = [];
  for (const image of images) {
    const result = await resizeImage(Buffer.from(image.data, "base64"), image.mimeType);
    if (!result) throw new AppError("INVALID_IMAGE", `图片 [${image.id}] 无法解码或调整大小；未发送任何图片，原始输入已保留。`);
    prepared.push({ ...image, data: result.data, mimeType: result.mimeType });
  }
  return prepared;
}
async function run(input: WorkerInput) {
  const bindStarted = performance.now();
  const runSend = leaseSender(activeLease, input.runId);
  const latency = new ModelLatency(input.runId, record => runSend({ type: "latency", record }));
  let restoreStream: (() => void) | undefined;
  let reusable = false;
  try {
    process.chdir(input.cwd);
    configureModelNetwork(input.root, input.modelsFile ?? defaultModelsPath(input.root), input.selection.provider);
    const originalImages = imagesInput(input.images);
    const images = await prepareImages(originalImages);
    if (!session) {
    const runtime = await new ModelService(input.root).runtime(
      input.modelsFile,
    );
    const model = runtime.getModel(
      input.selection.provider,
      input.selection.id,
    );
    if (!model || runtime.getError()) throw Error();
    requireImageModel(model, originalImages);
    const projectSettings = SettingsManager.create(
      input.cwd,
      join(input.root, "pi"),
      { projectTrusted: true },
    );
    // Package resolution precedes noExtensions filtering. Freeze child settings
    // without packages so reload cannot install project/global package resources.
    const settingsManager = input.task
      ? SettingsManager.fromStorage({ withLock: (scope, read) => {
          const values = scope === "global" ? projectSettings.getGlobalSettings() : projectSettings.getProjectSettings();
          read(JSON.stringify({ ...values, packages: [], cacheWarming: "off" }));
        } }, { projectTrusted: true })
      : projectSettings;
    // No speculative cache requests after a user stops or a worker finishes.
    settingsManager.applyOverrides({ cacheWarming: "off" });
    const openCliBaseEnvironment = { ...process.env };
    let opencli = input.task ? undefined : openCliResources(input.root, input.cwd, openCliBaseEnvironment);
    let rea = input.task ? undefined : reaResources(input.root, input.cwd);
    if (rea?.warning) send({ type: "warning", text: rea.warning });
    if (opencli?.warning) send({ type: "warning", text: opencli.warning });
    if (!input.task) applyOpenCliEnvironment(process.env, opencli?.env ?? openCliBaseEnvironment);
    const loader = createInstalledResourceLoader({
      cwd: input.cwd,
      agentDir: join(input.root, "pi"),
      settingsManager,
      ...environmentResourceOptions(input, () => ({ opencli, rea }), subagentPolicy),
      // Extensions execute arbitrary JS, may shadow read tools or add commands.
      // Only the host's inline lifecycle/permission hooks run in a child.
      ...(input.task ? { noExtensions: true, noPromptTemplates: true } : {}),
      extensionFactories: [rtkExtension(input.root, input.task ? "subagent" : "main"), ...(!input.task && input.capabilities ? capabilityExtensions(input.capabilities, input.root) : []), (pi) => {
        const spawnHook: BashSpawnHook = context => ({ ...context, env: toolEnvironment(context.env) });
        pi.registerTool({ ...createBashToolDefinition(input.cwd, { spawnHook,
          shellPath: settingsManager.getShellPath(), commandPrefix: settingsManager.getShellCommandPrefix() }), defaultActive: false });
        pi.registerTool({ ...createPowerShellToolDefinition(input.cwd, { spawnHook }), defaultActive: false });
        let taskSystemPrompt: string | undefined;
        pi.on("before_provider_request", () => { send({ type: "provider_request" }); });
        pi.on("tool_call", (event) => {
          const inputPath = (event.input as Record<string, unknown>).path;
          if (!["edit", "write"].includes(event.toolName) || typeof inputPath !== "string") return;
          const path = resolve(input.cwd, inputPath);
          if ((within(join(input.root, "memory"), path) || within(memoryRoot(input.root), path)) && (!input.memoryPath || !within(dirname(input.memoryPath), path)))
            return { block: true, reason: "只能维护所属主会话的记忆；其他来源记忆只读。" };
          if (input.memoryPath) {
            try { guardMemoryEdit(input.memoryPath, event.toolName, { ...event.input, path }); }
            catch (error) { return { block: true, reason: (error as Error).message }; }
          }
        });
        if (input.memoryPath) pi.on("tool_result", (event) => {
          try { if (session) recordMemoryRead(session.sessionManager, input.memoryPath!, input.cwd, event); }
          catch { /* Optional recovery bookkeeping must not interrupt tool execution. */ }
        });
        if (input.task) pi.on("tool_call", (event) => {
          if (taskPhase.stage !== "work" || taskPhase.revision !== handledTaskTransition) return { block: true, reason: "总结或恢复准备阶段禁止调用任何工具。" };
          if (!subagentTools.includes(event.toolName))
            return { block: true, reason: "子代理仅限调研与测试工具；代码修改须交给主代理，不能递归委派或加载外部工具。" };
        });
        pi.on("context", ({ messages }) => {
          // The empty host trigger starts the public Session lifecycle, but must
          // never become a user turn in provider requests or restored context.
          if (session && messages.some(isResumeControl)) {
            omitResumeControls(session);
            send({ type: "context-rebuilt" });
          }
          messages = messages.filter((message) => !isResumeControl(message));
          if (input.memoryPath && session && pendingMemoryRead(session.sessionManager)) messages.push({
            role: "custom", customType: "axiom-memory-restore", content: `上下文压缩已实际应用。尝试用 read 重新读取 ${input.memoryPath}；记忆是可选资料，读不到就按空记忆继续工作，不报错或等待修复。提示送达不代表已读取，也不要声称已恢复未读到的背景。保留本次 compactionId 与既有对话边界，不把压缩前原对话回填为当前上下文。`, display: false, timestamp: Date.now(),
          });
          return { messages };
        });
        pi.on("context_with_system", ({ messages }) => {
          if (input.task) {
            // Pi regenerates tool/rule/skill prompt sections when summary mode
            // disables tools. Keep the first request's instructions stable while
            // replaying the current declarations; phase controls stay at the tail.
            const system = getCurrentSystemMessage(messages);
            if (system) {
              taskSystemPrompt ??= getSystemMessageText(system);
              messages = [{ role: "system", content: taskSystemPrompt, timestamp: system.timestamp,
                ...(system.toolsAdded ? { toolsAdded: system.toolsAdded } : {}) },
                ...messages.filter(message => message.role !== "system")];
            }
          }
          if (session && !input.task && activeInput?.memoryTopics)
            messages = injectTopicSnapshot(messages, ensureTopicSnapshot(session.sessionManager, activeInput.memoryTopics));
          if (session && !cancelled && !compressionClosed && input.memoryPath)
            messages = compressionMemory.context(session, messages);
          return { messages };
        });
        // Route main-session compaction through the host's reminder and snapshot flow.
        pi.on("session_before_compact", (event) => {
          if (event.reason === "threshold") return { cancel: true };
          if (input.memoryPath) {
            send({ type: "warning", text: "原生压缩未执行：请使用会话压缩入口。" });
            return { cancel: true };
          }
        });
        pi.on("turn_end", (event) => compressionBoundary(event));
        pi.on("agent_before_settle", (event) => compressionBoundary(event));
      }],
    }, () => send({ type: "warning", text: "资源包尚未安装或版本不匹配。请到资源页安装或更新后重载，会话不会自动下载。" }));
    prepareReload = async (capabilities) => {
      if (input.task) await projectSettings.reload();
      else {
        if (capabilities && input.capabilities) Object.assign(input.capabilities, capabilities);
        if (input.capabilities) {
          const catalog = await discoverCapabilities(input.root, input.cwd, new ModelService(input.root).dir);
          const selection = input.capabilities.selection;
          if (selection.mcp.length && catalog.config.errors.length)
            throw Error("MCP 配置无法完整读取，未应用重载；请修复配置后重试。");
          if (selection.skills?.some(id => !catalog.skills.some(item => item.id === id)) || selection.mcp.some(id => !catalog.mcp.some(item => item.id === id)))
            throw Error("已选择的 Skills 或 MCP 资源不可用，请恢复对应资源后重试。");
          Object.assign(input.capabilities, capabilityRuntime(catalog, selection));
        }
        opencli = openCliResources(input.root, input.cwd, openCliBaseEnvironment);
        applyOpenCliEnvironment(process.env, opencli.env ?? openCliBaseEnvironment);
        rea = reaResources(input.root, input.cwd);
      }
    };
    await loader.reload();
    settingsManager.applyOverrides({ cacheWarming: "off" });
    const result = await createAgentSession({
      cwd: input.cwd,
      agentDir: join(input.root, "pi"),
      modelRuntime: runtime,
      model,
      thinkingLevel: input.selection.thinking,
      settingsManager,
      resourceLoader: loader,
      sessionManager: openTranscript(input.file, input.cwd),
      customTools: input.task ? [] : [...taskTools(callTask), memoryQueryTool((id, params, signal) => callTask("memory_query", id, params, signal)), memoryDetailTool(() => activeInput?.memoryPath)],
      ...(input.task
        ? { tools: subagentTools, excludeTools: [...taskToolNames] }
        // Main agents keep authorized extension tools and the platform shell.
        : process.platform === "win32" && !settingsManager.getSettings().defaultTools
          ? { tools: ["-bash", "+powershell"] }
          : {}),
    });
    session = result.session;
    sdkStream = session.agent.streamFunction;
    if (!input.task && input.memoryTopics) ensureTopicSnapshot(session.sessionManager, input.memoryTopics);
    const nativePrompt = session.agent.prompt, nativeContinue = session.agent.continue;
    session.agent.prompt = (async (...args: Parameters<typeof nativePrompt>) => {
      if (activeInput?.reloadId || reloading) throw Error("重载期间不允许扩展发起模型请求。");
      await nativePrompt.apply(session!.agent, args);
    }) as typeof nativePrompt;
    session.agent.continue = async () => {
      if (activeInput?.reloadId || reloading) throw Error("重载期间不允许扩展发起模型请求。");
      await nativeContinue.call(session!.agent);
    };
    const previousFinishTurn = session.agent.finishTurn;
    session.agent.finishTurn = async (turn, signal) => {
      const decision = await previousFinishTurn?.(turn, signal);
      if (!pendingReload || cancelled || inputClosed || taskPhase.revision !== handledTaskTransition) return decision || undefined;
      const id = pendingReload; pendingReload = undefined;
      accepting = false;
      // All tools and extension boundary drafts have finished. Session.abort's
      // synchronous flag suppresses automatic continuation; await only outside
      // this hook, after the native lifecycle has settled.
      reloadPause = { id, settled: session!.abort(), resume: decision?.action !== "end" &&
        (decision?.action === "continue" || turn.message.role === "assistant" && turn.message.stopReason === "toolUse" || session!.pendingMessageCount > 0) };
      void reloadPause.settled.catch(() => {});
      return { action: "end" };
    };
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
        ...new Set([...session.getActiveToolNames(), ...taskToolNames, "memory_query", "memory_detail"]),
      ]);
    await session.setModel(model);
    session.setThinkingLevel(input.selection.thinking);
    if (session.thinkingLevel !== input.selection.thinking) throw Error();
    environment = runtimeEnvironment(session, input);
    loadedResources = resourceSnapshot(session, input.capabilities);
    send({ type: "resources-loaded", resources: loadedResources });
    } else {
      // Extensions may have changed the effective model or thinking level during the previous run.
      const model = session.modelRuntime.getModel(input.selection.provider, input.selection.id);
      if (!model) throw Error();
      await session.setModel(model);
      session.setThinkingLevel(input.selection.thinking);
      session.refreshContext();
      environment = runtimeEnvironment(session, input);
      requireImageModel(session.model, originalImages);
    }
    const skillInput = prepareSkillInput(input.prompt, input.skills, session);
    await awaitExecutionPermit(activeLease, input.executionGate);
    if (cancelled) throw Error('执行已取消');
    if (input.reloadId) {
      await performReload(input.reloadId, false, true);
      reusable = session.isIdle;
      return;
    }
    send({ type: "execution_phase", stage: "bind", durationMs: performance.now() - bindStarted });
    const historyStarted = performance.now();
    deliveryCursor = new PersistedInputCursor();
    notificationIds.clear();
    persistedNotifications.clear();
    for (const id of deliveryCursor.read(input.file).notifications) {
      notificationIds.add(id);
      persistedNotifications.add(id);
    }
    send({ type: "execution_phase", stage: "history", durationMs: performance.now() - historyStarted });
    const baseStream = session.agent.streamFunction;
    const observedStream = latency.wrap(baseStream, {
      sessionId: session.sessionManager.getSessionId(),
      defaultFetch: model => baseStream === sdkStream &&
        !session!.modelRuntime.getRegisteredProviderConfig(model.provider)?.streamSimple &&
        !session!.modelRuntime.getRegisteredNativeProvider(model.provider),
    });
    session.agent.streamFunction = observedStream;
    restoreStream = () => { if (session?.agent.streamFunction === observedStream) session.agent.streamFunction = baseStream; };
    let previousSelection = lastRequestSelection(session.sessionManager.getBranch());
    send({ type: "ready", environment });
    let currentId = "",
      firstUser = true,
      announcedRunning = false;
    const runMessages: AgentMessage[] = [];
    let aborted = false;
    let retry: RetryInfo | undefined;
    let currentPhase: RunPhase | undefined;
    const phase = (value: RunPhase) => {
      if (currentPhase === value) return;
      currentPhase = value;
      send({ type: "progress", phase: value });
    };
    const publishRetry = () => send({ type: "progress", phase: currentPhase, retry });
    phase("requesting");
    let publishedEnvironment = JSON.stringify(environment);
    const publishPrompt = () => {
      const next = runtimeEnvironment(session!, activeInput!);
      const serialized = JSON.stringify(next);
      if (serialized === publishedEnvironment) return;
      publishedEnvironment = serialized;
      environment = next;
      send({ type: "system-prompt", systemPrompt: next.systemPrompt, environment: next });
    };
    unsubscribeRun = session.subscribe((event) => {
      const send = runSend;
      if ((event.type === "message_start" || event.type === "message_update" || event.type === "message_end") && isResumeControl(event.message)) return;
      // Includes before_agent_start overrides and subsequent tool-loadout changes.
      // Publish only changed snapshots, never once per streamed token.
      if (["agent_start", "turn_start", "message_start", "turn_end"].includes(event.type))
        publishPrompt();
      if (["queue_update", "message_start", "message_end", "turn_end"].includes(event.type))
        queueMicrotask(() => { if (activeInput?.runId === input.runId) publishQueue(); });
      if (event.type === "turn_end" || event.type === "agent_settled")
        for (const id of [...compressionCommitting.keys()]) acknowledgeCompression(id);
      if (event.type === "entry_appended" && event.entry.type === "compaction") {
        const id = (event.entry.details as { axiomCompressionId?: string } | undefined)?.axiomCompressionId;
        if (id) acknowledgeCompression(id);
        send({ type: "context-rebuilt" });
      }
      if (event.type === "entry_appended" && event.entry.type === "context_edit")
        send({ type: "context-rebuilt" });
      if (event.type === "agent_settled") {
        aborted = event.aborted;
        phase("settling");
      }
      if (event.type === "turn_start") {
        if (retry?.state === "waiting") {
          retry = { ...retry, state: "retrying", nextRetryAt: undefined };
          phase("retrying");
          publishRetry();
        } else phase("requesting");
      }
      // prompt() performs async image normalization before it starts streaming.
      // Only now may the scheduler hand over the remaining queued inputs.
      if (event.type === "agent_start" && !cancelled) {
        accepting = true;
        announceTaskBudget();
        if (taskPhase.stage === "work") budgetReminder?.flush();
        if (!announcedRunning) { announcedRunning = true; send({ type: "running" }); }
      }
      if (event.type === "message_start") {
        if (event.message.role === "assistant") phase("generating");
        currentId =
          event.message.role === "custom" &&
          (event.message.details as any)?.axiomInput
            ? `input-${(event.message.details as any).axiomInput}`
            : event.message.role === "toolResult"
              ? `tool-${toolKey(input.runId, event.message.toolCallId)}`
              : event.message.role === "user" && firstUser
                ? input.runId
                : randomUUID();
        if (event.message.role === "user" && firstUser)
          (event.message as any).axiomInputIds = input.task?.inputIds ?? (input.requestId ? [input.requestId] : []);
        if (event.message.role === "user") firstUser = false;
        (event.message as any).axiomId = currentId;
        if (event.message.role === "user" && currentId === input.runId && images.length)
          (event.message as any).axiomImages = imageMetadata(originalImages);
      }
      if (
        event.type === "message_start" ||
        event.type === "message_update" ||
        event.type === "message_end"
      ) {
        const m = event.message as any;
        m.axiomId ??= currentId || randomUUID();
        m.axiomRunId = input.runId;
        if (m.role === "user" && m.axiomId === input.runId && skillInput.metadata) m.axiomSkillInput = skillInput.metadata;
        if (m.role === "assistant") {
          const effective = requestSelection(m, session!.thinkingLevel);
          // Stream events are separate copies. Reattach on every event, including
          // message_end before pi persists it. Failed or truncated recovery attempts
          // may be omitted; carry their change until a retained response uses it.
          m.axiomSelectionChange = selectionChange(previousSelection, effective);
          if (event.type === "message_end" && effective && !["error", "length"].includes(m.stopReason))
            previousSelection = effective;
        }
        const message = chatMessage(
          m,
          m.axiomId,
          event.type !== "message_end" && m.role === "assistant",
        );
        if (m.role === "assistant") {
          if (event.type === "message_update") {
            const update = event.assistantMessageEvent;
            if (update.type === "text_delta" && update.delta) latency.first("text");
            if (update.type === "thinking_delta" && update.delta) latency.first("thinking");
            if (update.type === "toolcall_delta" && update.delta) latency.first("toolcall");
          }
        }
        if (message) {
          if (m.role === "assistant") message.deliveryTiming = latency.delivery();
          send({ type: "message", message });
        }
      }
      if (
        event.type === "tool_execution_start" ||
        event.type === "tool_execution_update" ||
        event.type === "tool_execution_end"
      ) {
        if (event.type === "tool_execution_start") phase("executing_tools");
        send({
          type: "tool",
          id: toolKey(input.runId, event.toolCallId),
          name: event.toolName,
          durationMs: event.type === "tool_execution_end" ? event.durationMs : undefined,
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
        send({ type: "usage", usage: usage(), autoCheck: event.message.role === "assistant" &&
          ["stop", "toolUse"].includes(event.message.stopReason) });
      }
      if (event.type === "message_end") {
        runMessages.push(event.message);
        setImmediate(() => {
          if (activeInput?.runId !== input.runId) return;
          delivered();
          // Public message_end precedes native persistence. Publish after append,
          // without waiting for this response's tools to finish at turn_end.
          if (event.message.role === "assistant") send({ type: "usage", usage: usage() });
        });
      }
      if (event.type === "auto_retry_start") {
        latency.retry("start", event.attempt, event.delayMs, latencyError(event.errorMessage));
        retry = { runId: input.runId,
          episodeId: event.attempt === 1 || !retry ? randomUUID() : retry.episodeId,
          attempt: event.attempt, maxAttempts: event.maxAttempts, state: "waiting",
          nextRetryAt: Date.now() + event.delayMs,
          message: errorMessage(event.errorMessage, "未收到具体错误原因。") };
        phase("retry_wait");
        publishRetry();
      }
      if (event.type === "auto_retry_end" && retry) {
        latency.retry("end", event.attempt, undefined, event.success ? "ok" : latencyError(event.finalError));
        retry = { ...retry, attempt: event.attempt, nextRetryAt: undefined,
          state: event.success ? "succeeded" : cancelled || event.finalError === "Retry cancelled" ? "cancelled" : "exhausted",
          ...(event.finalError ? { message: errorMessage(event.finalError, "重试未成功。") } : {}) };
        phase(event.success ? "generating" : "settling");
        publishRetry();
      }
      if (event.type === "compaction_start" && event.reason !== "threshold") phase("compacting");
      if (event.type === "compaction_end" && event.reason !== "threshold") phase(event.willRetry ? "requesting" : "settling");
    });
    compressionBoundary();
    if (input.task) session.setActiveToolsByName(taskPhase.stage === "summary" ? [] : subagentTools);
    handledTaskTransition = taskPhase.revision;
    let phaseMessageStart = 0;
    if (!cancelled) {
      send({ type: "usage", usage: usage(), autoCheck: true });
      if (input.resume) {
        if (input.task?.budget) {
          announcedBudget = budgetKey(input.task.budget);
          await session.sendCustomMessage({ customType: "axiom-budget", display: false,
            content: taskBudgetIntro(input.task.budget), details: { runId: input.runId } }, { triggerTurn: false });
        }
        await resumeSession(session, input.task?.inputIds[0] ?? input.requestId);
        send({ type: "context-rebuilt" });
      } else if (input.compressionPreparation) {
        // Reuse the public prompt lifecycle without adding a synthetic user turn.
        await resumeReloadedSession(session);
      } else if (input.memoryContinuation) {
        await session.sendCustomMessage({ customType: "axiom-memory-continuation", content: input.prompt, display: false,
          details: { runId: input.runId } }, { triggerTurn: true });
      } else if (input.notification) {
        const all = input.notification.items ?? [input.notification];
        const items = all.filter((item) => !notificationIds.has(item.id));
        for (const item of all) if (persistedNotifications.has(item.id)) send({ type: "delivered", ids: [item.id] });
        for (const [index, item] of items.entries()) {
          notificationIds.add(item.id);
          await session.sendCustomMessage({ customType: "axiom-result", content: item.content, display: true,
            details: { axiomInput: item.id } }, { triggerTurn: index === items.length - 1 });
        }
      } else if (!input.task?.editable || input.task.inputIds.every((id) => pendingInputs.has(id))) {
        // Claim the initial input synchronously before calling prompt: from this
        // point it is no longer an editable queue entry (including async preflight).
        for (const id of input.task?.inputIds ?? []) {
          pendingInputs.delete(id);
          send({ type: "input-accepted", id });
        }
        publishQueue();
        const budget = input.task?.budget;
        if (budget) {
          announcedBudget = budgetKey(budget);
          await session.sendCustomMessage({ customType: "axiom-budget", display: false,
            content: taskBudgetIntro(budget), details: { runId: input.runId } }, { triggerTurn: false });
        }
        await session.prompt(skillInput.prompt, {
          expandPromptTemplates: !skillInput.metadata && !input.rewrite && !input.task && !images.length,
          images: nativeImages(images),
        });
      }
    }
    const drainReloads = async () => {
      while (reloadPause || pendingReload) {
        const pause = reloadPause;
        const id = pause?.id ?? pendingReload!;
        pendingReload = undefined;
        await pause?.settled;
        await session!.waitForIdle();
        if (cancelled) break;
        const resume = Boolean(pause?.resume) && taskPhase.revision === handledTaskTransition;
        const report = await performReload(id, resume);
        reloadPause = undefined;
        aborted = false;
        if (resume) {
          try { await resumeReloadedSession(session!, report); }
          catch (error) {
            send({ type: "reload-result", id, ok: false, error: errorMessage(error, "资源已重载，但未能自动恢复执行。") });
            throw error;
          }
        }
      }
    };
    await drainReloads();
    // Native abort/settlement ends one phase, not the owning business run.
    // All model turns stay serialized here; IPC only changes the desired phase.
    while (input.task && !cancelled && taskPhase.revision !== handledTaskTransition) {
      await phaseAbort;
      await session.waitForIdle();
      const transition = taskPhase.revision;
      const stage = taskPhase.stage;
      if (stage === "work") {
        accepting = true;
        // A newer deadline must be able to interrupt a blocked image/input drain.
        while (!cancelled && transition === taskPhase.revision) {
          const tail = inputQueue;
          await taskPhase.drain(tail, transition);
          if (cancelled || transition !== taskPhase.revision) break;
          if (tail !== inputQueue) continue;
          if (resumeSubmission?.accepted) break;
          if (!resumeSubmission?.uncertain)
            throw new AppError("TASK_RESUME_FAILED", "追加输入未成功进入上下文；未恢复工作。");
          // A later successful append wakes this gate without requiring another
          // phase change. Deadlines still interrupt the wait independently.
          await taskPhase.drain(resumeSubmission.ready, transition);
        }
      }
      if (cancelled) break;
      if (transition !== taskPhase.revision) continue;
      handledTaskTransition = transition;
      aborted = false;
      phaseMessageStart = runMessages.length;
      // An aborted turn may leave unconsumed reminders or appends in pi's
      // queues. Persist them in delivery order before the new phase control;
      // otherwise an old countdown can arrive after the summary instruction.
      const queued = nativeQueuedMessages(session);
      if (queued.some(message => message.role !== "custom"))
        throw new AppError("TASK_PHASE_QUEUE", "子任务阶段切换遇到未知输入；未丢弃队列。");
      session.agent.clearSteeringQueue();
      session.agent.clearFollowUpQueue();
      for (const message of queued) if (message.role === "custom")
        await session.sendCustomMessage(message, { triggerTurn: false });
      if (cancelled || transition !== taskPhase.revision) continue;
      session.setActiveToolsByName(stage === "summary" ? [] : subagentTools);
      if (stage === "work" && input.task.budget) budgetReminder?.update(input.task.budget);
      await session.sendCustomMessage({
        customType: stage === "summary" ? "axiom-task-summary" : "axiom-task-work",
        content: stage === "summary" ? taskSummaryInstruction :
          `${taskBudgetUpdate(input.task.budget!)}\n已收到新的追加要求，恢复工作。结合此前证据处理追加内容；核对已执行操作的结果，不自动重做已有工具操作。`,
        display: false,
      }, { triggerTurn: true });
      await drainReloads();
    }
    accepting = false;
    inputClosed = true;
    // Report every accepted normalization job before done/closed so settlement
    // cannot mistake unfinished decode work for an input safe to replay.
    await inputQueue;
    await session.waitForIdle();
    const outcome = executionOutcome(runMessages.slice(phaseMessageStart), cancelled, aborted, announcedRunning);
    compressionBoundary();
    closeCompressionRequests();
    delivered();
    reusable = outcome.status === "completed" && session.isIdle && pendingCalls.size === 0;
    send({ type: "done", ...outcome,
      ...(input.task && taskPhase.stage === "summary" && outcome.status === "completed" ? { reasonCode: "BUDGET_SUMMARY" } : {}), usage: usage() });
  } catch (error) {
    // A denied permit can be followed by retirement in the same IPC turn,
    // before this catch runs. Keep that failure distinct from a user stop.
    const wasCancelled = cancelled && !(error instanceof ExecutionPermitDeniedError);
    accepting = false;
    inputClosed = true;
    await session?.abort();
    await inputQueue;
    closeCompressionRequests();
    send({
      type: "done",
      status: wasCancelled ? "cancelled" : "failed",
      reasonCode: wasCancelled ? "USER_STOPPED" : error instanceof AppError ? error.code : "EXECUTION_ERROR",
      error: errorMessage(error, "pi 初始化或执行失败，未收到具体错误原因。"),
    });
  } finally {
    restoreStream?.();
    budgetReminder?.dispose();
    closeCompressionRequests();
    unsubscribeRun?.();
    unsubscribeRun = undefined;
    if (reusable && !capabilityReloadChanged && process.connected) {
      started = false;
      send({ type: "idle" });
    } else {
      await shutdown();
    }
  }
}
