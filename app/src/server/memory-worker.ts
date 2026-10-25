import { configureModelNetwork, defaultModelsPath } from "./integrations/model-proxy-env.js";
import type { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { cleanupSessionResources, getSupportedThinkingLevels } from "@earendil-works/pi-ai";
import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { memoryIncompleteMessages, type MemoryIncompleteReason } from "../shared/memory.js";
import type { Selection } from "../shared/agent.js";
import { memoryOrganizationOutputChars } from "../shared/memory-tree.js";
import { organizationModelBudget } from "./memory-organization-capacity.js";
import { AppError } from "../shared/protocol.js";
import { ModelService } from "./model-service.js";
import { acceptsLease, awaitExecutionPermit, instanceSend, leaseSender, sameLease, workerInstance, type LeaseRef } from "./execution-protocol.js";

export interface MemoryWorkerInput {
  kind: "query" | "organize" | "title"; executionGate?: boolean; root: string; cwd: string; modelsFile?: string;
  selection: Selection; prompt: string; systemPrompt?: string; outputReserve?: number;
}
type Binding = { ref?: LeaseRef; controller: AbortController };
let runtime: ModelRuntime | undefined, preparing: Promise<void> | undefined, active: Binding | undefined, closing = false;
// This identifies a transport slot, never a model conversation. Each call sends a new complete Context.
const transportId = `memory-${workerInstance?.instanceId ?? randomUUID()}`;
async function prepare(input: Pick<MemoryWorkerInput, "root" | "modelsFile"> & { selection?: Selection }) {
  const provider = input.selection?.provider ?? process.env.AXIOM_MODEL_PROVIDER;
  if (!provider) throw Error("记忆执行环境缺少供应商配置。");
  configureModelNetwork(input.root, input.modelsFile ?? defaultModelsPath(input.root), provider);
  runtime ??= await new ModelService(input.root).runtime(input.modelsFile);
  if (runtime.getError()) throw Error("记忆模型不可用，未静默切换");
}
function exit() {
  cleanupSessionResources(transportId);
  if (process.connected) process.disconnect();
  process.exitCode = 0;
  process.removeAllListeners("message");
  process.removeAllListeners("disconnect");
}
process.on("disconnect", () => { closing = true; if (active) active.controller.abort(); else exit(); });
process.on("message", (event: any) => {
  if (event.type === "prepare" && !active && !preparing && !closing && event.instance?.instanceId === workerInstance?.instanceId && event.instance?.generation === workerInstance?.generation && event.instance?.profileHash === workerInstance?.profileHash) {
    const start = performance.now();
    preparing = prepare(event.input).then(() => { if (!closing) instanceSend({ type: "environment_ready", durationMs: performance.now() - start }); })
      .catch(() => { instanceSend({ type: "prepare_failed" }); closing = true; exit(); });
    return;
  }
  if (event.type === "shutdown") { closing = true; if (active) active.controller.abort(); else exit(); return; }
  if (event.type === "start" && !active && !closing && acceptsLease(event.lease)) {
    active = { ref: event.lease ? Object.freeze({ ...event.lease }) : undefined, controller: new AbortController() };
    void run(event.input, active); return;
  }
  if (!active || workerInstance && !sameLease(event.lease, active.ref)) return;
  if (event.type === "stop") { closing = true; active.controller.abort(); }
});
async function run(input: MemoryWorkerInput, binding: Binding) {
  const send = leaseSender(binding.ref), signal = binding.controller.signal;
  let success = false;
  try {
    const begin = performance.now();
    await preparing; await prepare(input); signal.throwIfAborted();
    const model = runtime!.getModel(input.selection.provider, input.selection.id);
    if (!model) throw Error("记忆模型不可用，未静默切换");
    if (!getSupportedThinkingLevels(model).includes(input.selection.thinking)) throw Error("记忆模型不支持所选思考等级");
    const outputOptions = input.kind === "organize" ? organizationModelBudget(input, model) : {};
    await awaitExecutionPermit(binding.ref, input.executionGate); signal.throwIfAborted();
    send({ type: "execution_phase", stage: "bind", durationMs: performance.now() - begin });
    const usageId = randomUUID();
    send({ type: "usage", id: usageId, provider: model.provider, model: model.id, usage: null });
    send({ type: "model_call" });
    const result = await runtime!.completeSimple(model, {
      systemPrompt: input.systemPrompt,
      messages: [{ role: "user", content: input.prompt, timestamp: Date.now() }],
    }, {
      signal, sessionId: transportId, transport: "websocket", cacheRetention: "short", maxRetries: 0, ...outputOptions,
      ...(input.selection.thinking === "off" ? {} : { reasoning: input.selection.thinking }),
    });
    send({ type: "model_result", result });
    // Record incurred usage even when cancellation or an invalid stop reason prevents publication.
    send({ type: "usage", id: usageId, provider: result.provider, model: result.responseModel ?? result.model, usage: result.usage });
    signal.throwIfAborted();
    if (result.stopReason === "error" || result.stopReason === "aborted") {
      const message = result.errorMessage || "记忆模型请求失败";
      // Only an explicit provider rate-limit rejection is safe to retry. A lost
      // response, generic network failure or timeout may already have been billed.
      if (result.stopReason === "error" && /\b429\b|rate_limit_exceeded/i.test(message)) throw new AppError("MEMORY_RETRYABLE", message);
      throw Error(message);
    }
    if (result.stopReason !== "stop" && result.stopReason !== "length") throw Error("记忆模型未返回同步文本结果");
    if (result.content.some((part) => part.type === "toolCall")) throw Error("记忆请求不允许工具调用");
    const answer = result.content.filter((part) => part.type === "text").map((part) => part.text).join("");
    let incompleteReason: MemoryIncompleteReason | undefined = result.stopReason === "length" ? "model_output_limit" : undefined;
    if (input.kind === "organize" && answer.length > memoryOrganizationOutputChars)
      throw new AppError("MEMORY_LIMIT", "整理完整输出超过容量，未截断或发布");
    if (input.kind !== "organize" && answer.length > 32000) incompleteReason ??= "output_limit";
    if (!answer && !incompleteReason && input.kind === "organize") throw Error("记忆模型未返回结果");
    send({ type: "completed", answer: (input.kind === "organize" ? answer : answer.slice(0, 32000)) || (incompleteReason ? memoryIncompleteMessages[incompleteReason] : ""), incomplete: !!incompleteReason, incompleteReason });
    success = true;
  } catch (error) { send({ type: "failed", error: error instanceof Error ? error.message : "记忆执行失败", code: error instanceof AppError ? error.code : undefined }); }
  finally {
    active = undefined;
    if (success && !closing && !signal.aborted) {
      send({ type: "execution_phase", stage: "clean", durationMs: 0 });
      send({ type: "cleaned", clean: true });
    } else exit();
  }
}
