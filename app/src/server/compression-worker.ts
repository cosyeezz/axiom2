import { configureModelNetwork } from "./integrations/model-proxy-env.js";
import { randomUUID } from "node:crypto";
import { acceptsLease, awaitExecutionPermit, ExecutionPermitDeniedError, leaseSender, sameInstance, sameLease, workerInstance, type LeaseRef } from "./execution-protocol.js";
import { join } from "node:path";
import {
  createAgentSession,
  DefaultResourceLoader,
  SettingsManager,
  type AgentSession,
  type SessionBeforeCompactEvent,
} from "@earendil-works/pi-coding-agent";
import type { Selection } from "../shared/agent.js";
import { ModelService } from "./model-service.js";
import { invalidModelDefinition } from "./model-runtime.js";
import { openTranscript } from "./transcript.js";
import { compactionInstructions } from "./compaction-display.js";
import { compressionError } from "./compression-error.js";
import { assertCompressionBudget, assertCompressionPrefix, compressionModelIdentity, compressionPrefixRequest, compressionRequestOptions, type CompressionPrefix } from "./compression-request.js";
import { sumCosts, type CostTotals } from "../shared/costs.js";
import { usageCost } from "./usage-cost.js";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import { kiroCompressionProjection, kiroSummaryUsage } from "./providers/kiro-usage.js";
import { installKiroCompactionUsage } from "./kiro-compaction-usage.js";

export interface CompressionInput {
  executionGate?: boolean;
  root: string;
  cwd: string;
  file: string;
  modelsFile: string;
  selection: Selection;
  request?: CompressionPrefix;
}
let session: AgentSession | undefined,
  cancelled = false,
  started = false;
let activeLease: LeaseRef | undefined;
const send = (value: unknown) => leaseSender(activeLease)(value);
process.on("disconnect", () => process.exit(1));
process.on("message", (event: any) => {
  if (event.type === "shutdown" && !started) { process.exit(0); return; }
  if (event.type === "start" && !acceptsLease(event.lease)) return;
  if (event.type !== "start" && !(event.type === "shutdown" && sameInstance(event.instance)) && workerInstance && !sameLease(event.lease, activeLease)) return;
  if (event.type === "stop" || event.type === "shutdown") {
    cancelled = true;
    session?.abortCompaction();
  }
  if (event.type === "start" && !started) {
    started = true;
    activeLease = event.lease ? Object.freeze({ ...event.lease }) : undefined;
    void run(event.input);
  }
});
async function run(input: CompressionInput) {
  const send = leaseSender(activeLease);
  const accounting: Promise<unknown>[] = [];
  try {
    if (!input.request) throw Error("没有可复用的真实会话请求前缀，未发送摘要请求。");
    const transcript = openTranscript(input.file, input.cwd);
    assertCompressionPrefix(input.request, transcript.getSessionId(), input.selection);
    configureModelNetwork(input.root, input.modelsFile, input.request.model.provider);
    const runtime = await new ModelService(input.root).runtime(
      input.modelsFile, false, input.selection.provider,
    );
    const model = runtime.getModel(
      input.request.model.provider,
      input.request.model.id,
    );
    const configurationError = await invalidModelDefinition(input.modelsFile, input.selection.provider);
    // Parser diagnostics may echo arbitrary secret configuration values.
    if (configurationError) throw Error("压缩模型配置读取失败，请检查供应商配置；原配置未修改。");
    if (!model || compressionModelIdentity(model) !== input.request.model.identity)
      throw Error("当前会话的实际请求模型配置已变化；无法复用其缓存前缀，请重试压缩。");
    const thinking = input.request.options.reasoning ?? "off";
    let preparation: SessionBeforeCompactEvent["preparation"] | undefined;
    // No project resources, external extensions or executable coding tools.
    // One host-only hook observes native preparation without replacing its result.
    const settingsManager = SettingsManager.inMemory({
      cacheWarming: "off",
      compaction: { enabled: false, keepRecentTokens: 0 },
    });
    const resourceLoader = new DefaultResourceLoader({
      cwd: input.cwd,
      agentDir: join(input.root, "pi"),
      settingsManager,
      noExtensions: true,
      extensionFactories: [(pi) => { pi.on("session_before_compact", (event) => { preparation = event.preparation; }); }],
      noSkills: true,
      noPromptTemplates: true,
      noThemes: true,
      noContextFiles: true,
      systemPrompt: "",
      appendSystemPrompt: [],
    });
    await resourceLoader.reload();
    ({ session } = await createAgentSession({
      cwd: input.cwd,
      agentDir: join(input.root, "pi"),
      modelRuntime: runtime,
      model,
      thinkingLevel: thinking,
      settingsManager,
      resourceLoader,
      sessionManager: transcript,
      noTools: "all",
    }));
    if (session.thinkingLevel !== thinking)
      throw Error("摘要请求未能使用会话的有效思考等级。");
    if (resourceLoader.getExtensions().errors.length) throw Error("原生摘要前缀适配器未能加载。");
    await session.bindExtensions({ mode: "rpc" });
    const compactionUsage = installKiroCompactionUsage(session, { externalBilling: true });
    session.subscribe((event) => {
      if (event.type === "compaction_start") send({ type: "phase" });
    });
    await awaitExecutionPermit(activeLease, input.executionGate);
    if (cancelled) return send({ type: "cancelled" });
    // Keep native preparation, retries, full/split summary formats and accounting.
    // Only the outgoing request changes: original transcript prefix + tail directive.
    // Tool declarations remain byte-aligned for caching; no agent loop executes them.
    const stream = session.agent.streamFunction;
    const charges: CostTotals[] = [], physical: AssistantMessage[] = [];
    const publishBilling = () => send({ type: "billing", billing: sumCosts(charges) });
    session.agent.streamFunction = async (model, context, options) => {
      // A split-prefix dispatch after cancellation never reaches native HTTP.
      // Keep nonKiro accounting unchanged; do not add a fictitious Kiro charge.
      if (model.api === "kiro-chat" && (options?.signal?.aborted || compactionUsage.isCancelled())) return stream(model, context, options);
      if (!preparation) throw Error("没有原生摘要范围，未发送摘要请求。");
      const request = compressionPrefixRequest(input.request!, session!.sessionManager.getBranch(), preparation, context);
      const requestOptions = compressionRequestOptions(input.request!, options);
      assertCompressionBudget(model, request, requestOptions);
      // Local validation is not a physical request. Record an unknown charge
      // only after preflight succeeds, but still before the provider can start.
      const index = charges.push(usageCost(null)) - 1;
      publishBilling();
      const callId = randomUUID();
      send({ type: "model_call", id: callId, input: request });
      let response: Awaited<ReturnType<typeof stream>>;
      try { response = await stream(model, request, requestOptions); }
      catch (error) { send({ type: "model_result", id: callId, error: compressionError(error) }); throw error; }
      // result() observes the same stream without consuming/replaying its events.
      accounting.push(response.result().then((message) => {
        send({ type: "model_result", id: callId, output: message, usage: message.usage, error: message.stopReason === "error" || message.stopReason === "aborted" ? message.errorMessage || "模型请求失败" : undefined });
        physical[index] = message;
        charges[index] = usageCost(message.usage, message.responseModel ?? message.model);
        publishBilling();
      }).catch((error) => { send({ type: "model_result", id: callId, error: compressionError(error) }); }));
      return response;
    };
    const result = await session.compact(compactionInstructions);
    if (model.provider === "kiro") await Promise.allSettled(accounting);
    const entry = session.sessionManager.getLeafEntry();
    if (entry?.type !== "compaction") throw Error("pi 未生成有效的原生压缩记录，摘要未应用。");
    // SDK combineUsage drops custom fields and has already appended its snapshot
    // entry. Enrich only the outgoing copy, which the owning writer applies once.
    const kiroUsage = model.provider === "kiro" ? kiroSummaryUsage(result.usage, physical) : undefined;
    send({
      type: "completed",
      entry: kiroUsage ? { ...entry, usage: kiroUsage } : entry,
      summary: result.summary,
      before: result.tokensBefore,
      after: result.estimatedTokensAfter ?? null,
      usage: kiroUsage ? kiroCompressionProjection(kiroUsage) :
        result.usage && result.usage.totalTokens > 0
          ? {
              input: result.usage.input,
              output: result.usage.output,
              total: result.usage.totalTokens,
              cacheRead: result.usage.cacheRead,
              cacheWrite: result.usage.cacheWrite,
              cost:
                result.usage.cost.total > 0 ? result.usage.cost.total : null,
            }
          : null,
    });
  } catch (error) {
    send(cancelled && !(error instanceof ExecutionPermitDeniedError) ? { type: "cancelled" } : { type: "failed", error: compressionError(error) });
  } finally {
    await Promise.allSettled(accounting);
    await session?.waitForIdle();
    session?.dispose();
    if (process.connected)
      process.send?.({ type: "closed", lease: activeLease }, () => process.exit(0));
    else process.exit(0);
  }
}
