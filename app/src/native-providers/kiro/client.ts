import { createHash } from "node:crypto";
import type { NativeContext, NativeStreamEvent, NativeStreamOptions, NativeToolCall } from "../contracts.js";
import type { KiroCredential } from "./auth.js";
import { validateKiroCredential } from "./catalog.js";
import { kiroNativeChatRequest, KiroChatError, kiroObject, kiroText } from "./protocol.js";
import { classifyKiroFailure, KiroServiceFailure, kiroFailureMessage, kiroLocalFailure, kiroPartialFailure, readKiroErrorBody } from "./failure.js";
import { observeKiroError } from "./error-observation.js";
import { readKiroEvents } from "./eventstream.js";
import { KiroResponsesError, kiroResponsesRequest, readKiroResponses, usesKiroResponses } from "./responses.js";
import { KiroThinkingError, kiroResponsesClaudeDefaultEffort, kiroThinkingCapabilities, kiroThinkingRequest, type KiroThinkingModelInput } from "./thinking.js";
import { KiroThinkingStream } from "./thinking-stream.js";
import { KiroToolInput } from "./tool-input.js";
import { readKiroTokenUsage } from "./usage.js";
import { resolveKiroProfile } from "./profile.js";
import { prepareKiroNativeRequest, sendKiroNativeRequest, waitForKiro, cancelKiroBody } from "./request.js";

export interface KiroStreamInput {
  model: { id: string } & Partial<Omit<KiroThinkingModelInput, "id">>;
  account: KiroCredential;
  context: NativeContext;
  options?: NativeStreamOptions;
}

/** One native sender, no SDK types, tool execution, model retries or credential refresh owner. */
export function createKiroClient(transport?: typeof fetch) {
  const lifetime = new AbortController();
  const profiles = new Map<string, { arn: string; expires: number }>();
  async function* stream({ model, account: credential, context, options = {} }: KiroStreamInput): AsyncGenerator<NativeStreamEvent> {
    let response: Response | undefined, usageSeen = false, usageIncomplete = false, partial = false, hasText = false;
    let stage: "request" | "transport" | "response" | "http" | "stream" = "request", unknownEvents = 0, unknownStops = 0;
    let handoff = false;
    let incomplete: { stopReason: string; reason?: string; known: boolean } | undefined;
    const ignoredEvents = new Map<string, number>();
    const timeout = options.timeoutMs ?? 600_000;
    const bounded = AbortSignal.any([lifetime.signal, ...(options.signal ? [options.signal] : []),
      AbortSignal.timeout(Number.isSafeInteger(timeout) && timeout > 0 ? Math.min(timeout, 3_600_000) : 600_000)]);
    const pending: NativeStreamEvent[] = [];
    const tools = new Map<string, { call: NativeToolCall; input: KiroToolInput; ended: boolean }>();
    function* drain() { while (pending.length) yield pending.shift()!; }
    const diagnostic = (type: string, details: Record<string, unknown>) => pending.push({ type: "diagnostic", diagnostic: { type, timestamp: Date.now(), details } });
    const appendText = (delta: string) => { hasText ||= !!delta.trim(); pending.push({ type: "text", delta }); };
    try {
      bounded.throwIfAborted();
      if (options.toolChoice !== undefined && options.toolChoice !== "auto") throw new KiroChatError("Kiro 原生协议当前只支持自动工具选择，不会忽略强制或禁用工具的要求。");
      if (context.tools?.length && typeof options.validateToolInput !== "function") throw new KiroChatError("Kiro 工具调用需要宿主提供严格的 JSON Schema 校验器；未发送请求。");
      const ignored = (["temperature", "maxTokens", "samplingParams"] as const).filter(key => options[key] !== undefined);
      if (ignored.length) diagnostic("kiro-unsupported-controls", { controls: ignored.join(","), note: "未猜测映射这些生成参数，服务使用自身默认值。" });
      let account = validateKiroCredential(credential);
      if (account.expires <= Date.now()) throw new KiroChatError("Kiro 访问令牌已过期，请刷新认证。");
      if (account.authMethod === "identity-center" && !account.profileArn) {
        const key = createHash("sha256").update(JSON.stringify([account.authMethod, account.authRegion, account.access])).digest("hex");
        for (const [id, value] of profiles) if (value.expires <= Date.now()) profiles.delete(id);
        const cached = profiles.get(key);
        if (cached) account = { ...account, profileArn: cached.arn };
        else {
          const discoverySignal = AbortSignal.any([bounded, AbortSignal.timeout(15_000)]);
          account = await waitForKiro(resolveKiroProfile(account, discoverySignal, options.fetch ?? transport ?? globalThis.fetch), discoverySignal);
          bounded.throwIfAborted();
          if (account.profileArn) {
            if (profiles.size >= 128) profiles.delete(profiles.keys().next().value!);
            profiles.set(key, { arn: account.profileArn, expires: Math.min(account.expires, Date.now() + 15 * 60_000) });
          }
        }
      }
      const { payload, names, seenCalls, historyNotice, interruptionNotice } = kiroNativeChatRequest(model.id, context, account, options.sessionId);
      const responses = usesKiroResponses(model.id);
      const capabilities = kiroThinkingCapabilities(model.id);
      const thinking = kiroThinkingRequest({ id: model.id,
        enabledThinkingLevels: model.enabledThinkingLevels ?? (["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const)
          .filter(level => level === "off" || capabilities.levels?.[level] != null),
        thinkingLevelMap: model.thinkingLevelMap ?? capabilities.levels }, options);
      if (thinking) {
        if (kiroResponsesClaudeDefaultEffort(model.id) && Object.hasOwn(options, "reasoning") && options.reasoning === undefined)
          diagnostic("kiro-thinking-off-unavailable", { appliedEffort: thinking.providerLevel, note: "该模型未声明可关闭思考；SDK off 使用目录默认 effort，不表示禁用思考。" });
        pending.push({ type: "thinking-level", level: thinking.providerLevel });
        if (thinking.additional) (payload as Record<string, unknown>).additionalModelRequestFields = thinking.additional;
        if (thinking.prefix) {
          const first = [...(payload.conversationState.history ?? []), payload.conversationState.currentMessage].find(item => "userInputMessage" in item);
          if (first && "userInputMessage" in first) first.userInputMessage.content = thinking.prefix + "\n" + first.userInputMessage.content;
        }
      }
      const tagged = thinking?.enabled && !responses ? new KiroThinkingStream() : undefined;
      const emitParts = (parts: ReturnType<KiroThinkingStream["push"]>) => {
        for (const part of parts) if (part.type === "thinking") pending.push({ type: "thinking", delta: part.text }); else appendText(part.text);
      };
      let unclosedReported = false;
      const flushTags = () => {
        if (!tagged) return;
        emitParts(tagged.finish());
        if (tagged.unclosed && !unclosedReported) {
          unclosedReported = true;
          diagnostic("kiro-thinking-tag-unclosed", { note: "思考标签未闭合；剩余内容仅按思考显示，不伪造正文或截断原因。" });
        }
      };
      if (Object.values(historyNotice).some(Boolean)) diagnostic("kiro-reasoning-history-omitted", historyNotice);
      if (interruptionNotice.omittedToolCalls) diagnostic("kiro-interrupted-tools-omitted", { ...interruptionNotice, executionState: "unknown", userBoundaryProvenance: "unverified", policy: "verify-before-repeating-side-effects" });
      yield* drain(); bounded.throwIfAborted();
      const nativePayload = responses ? kiroResponsesRequest(payload, options.continuationId) : payload;
      const replacement = await waitForKiro(options.onPayload?.(nativePayload), bounded), request = replacement === undefined ? nativePayload : kiroObject(replacement);
      const prepared = prepareKiroNativeRequest(model.id, account, request, options.headers);
      stage = "transport";
      response = await sendKiroNativeRequest(prepared, bounded, options.fetch ?? transport);
      bounded.throwIfAborted(); stage = "response";
      await waitForKiro(options.onResponse?.({ status: response.status, headers: Object.fromEntries(response.headers.entries()) }), bounded);
      bounded.throwIfAborted();
      if (!response.ok) {
        stage = "http";
        const failureBody = await readKiroErrorBody(response, bounded); bounded.throwIfAborted();
        const observation = response.status === 400 ? observeKiroError(failureBody) : undefined;
        if (observation) diagnostic("kiro-http400-observation", observation);
        throw new KiroServiceFailure(classifyKiroFailure({ stage: "http", status: response.status, body: failureBody,
          codes: [response.headers.get("x-amzn-errortype")], requestId: response.headers.get("x-amzn-requestid") ?? response.headers.get("x-amz-request-id") }));
      }
      stage = "stream";
      if (!response.body || !response.headers.get("content-type")?.toLowerCase().startsWith(responses ? "text/event-stream" : "application/vnd.amazon.eventstream"))
        throw new KiroChatError("Kiro 未返回所选原生协议的有效流式响应。");
      yield { type: "start" }; bounded.throwIfAborted();
      const events = responses ? readKiroResponses(response.body, bounded, model.id, async event => {
        if (typeof event.type === "string" && (event.type.endsWith(".delta") || event.type === "response.output_item.added")) partial = true;
        await waitForKiro(options.onProviderEvent?.(event), bounded);
      }) : readKiroEvents(response.body, bounded);
      for await (const event of events) {
        const { headers, data } = event, kind = headers[":event-type"];
        if (kind === "assistantResponseEvent" || kind === "reasoningContentEvent" || kind === "toolUseEvent" || "progress" in event && event.progress) partial = true;
        if (!responses) await waitForKiro(options.onProviderEvent?.(event), bounded);
        bounded.throwIfAborted();
        if (headers[":message-type"] !== "event") throw new KiroServiceFailure(classifyKiroFailure({ stage: "stream", status: response.status,
          codes: [headers[":exception-type"], headers[":error-code"]], body: { state: "json", data }, requestId: data.requestId }));
        if (kind === "assistantResponseEvent") {
          if (typeof data.content !== "string") throw new KiroChatError("Kiro 文本事件格式无效。");
          if (tagged) emitParts(tagged.push(data.content)); else appendText(data.content);
          if (kiroText(data.messageId)) pending.push({ type: "response-id", id: data.messageId });
        } else if (kind === "reasoningContentEvent") {
          flushTags();
          if (data.text !== undefined && typeof data.text !== "string" || data.signature !== undefined && typeof data.signature !== "string" || data.redactedContent !== undefined && typeof data.redactedContent !== "string") throw new KiroChatError("Kiro 思考事件格式无效。");
          pending.push({ type: "thinking", ...(typeof data.text === "string" ? { delta: data.text } : {}),
            ...(typeof data.signature === "string" ? { signature: data.signature } : {}),
            ...(typeof data.redactedContent === "string" ? { redacted: true, signature: data.redactedContent } : {}) });
        } else if (kind === "toolUseEvent") {
          flushTags();
          if (!kiroText(data.toolUseId, 256) || data.input !== undefined && typeof data.input !== "string" || data.stop !== undefined && typeof data.stop !== "boolean") throw new KiroChatError("Kiro 工具事件格式无效。");
          let tool = tools.get(data.toolUseId);
          if (!tool) {
            if (seenCalls.has(data.toolUseId)) throw new KiroChatError("Kiro 工具调用 ID 与既有历史重复；未执行该工具。");
            if (!kiroText(data.name, 64) || !names.has(data.name) || tools.size >= 1024) throw new KiroChatError("Kiro 返回了未声明、无效或过多的工具调用。");
            tool = { call: { id: data.toolUseId, name: names.get(data.name)!, arguments: {} }, input: new KiroToolInput(), ended: false };
            tools.set(data.toolUseId, tool); pending.push({ type: "tool-start", id: tool.call.id, name: tool.call.name });
          }
          if (tool.ended || data.name !== undefined && names.get(String(data.name)) !== tool.call.name) throw new KiroChatError("Kiro 工具调用重复结束或名称发生变化。");
          if (typeof data.input === "string") {
            tool.input.append(data.input);
            const preview = data.stop === true ? undefined : tool.input.preview();
            pending.push({ type: "tool-delta", id: tool.call.id, delta: data.input, ...(preview !== undefined ? { preview } : {}) });
          }
          yield* drain(); bounded.throwIfAborted();
          if (data.stop === true) {
            try { tool.call.arguments = kiroObject(JSON.parse(tool.input.complete() || "{}")); }
            catch { throw new KiroChatError("Kiro 工具参数 JSON 无效或被截断；未执行该工具。"); }
            try {
              const definition = context.tools?.find(item => item.name === tool.call.name);
              if (!definition || !options.validateToolInput) throw Error();
              const validated = await waitForKiro(options.validateToolInput(structuredClone(definition), structuredClone(tool.call)), bounded);
              if (JSON.stringify(validated) !== JSON.stringify(tool.call.arguments)) throw Error();
            } catch { throw new KiroChatError("Kiro 工具参数不符合声明的 JSON Schema；未执行该工具。"); }
            bounded.throwIfAborted();
            tool.ended = true; pending.push({ type: "tool-end", call: structuredClone(tool.call) });
          }
        } else if (kind === "metadataEvent") {
          if (data.stopReason === "CONTENT_FILTERED") throw new KiroChatError("Kiro 服务拦截了当前内容，未将拒答伪装为空回复。");
          if (Object.hasOwn(data, "stopReason")) unknownStops++;
          if (responses && data.incomplete && typeof data.incomplete === "object") incomplete = data.incomplete as typeof incomplete;
          if (Object.hasOwn(data, "tokenUsage")) {
            usageIncomplete = true;
            yield { type: "usage", state: "partial" }; bounded.throwIfAborted();
            const counts = readKiroTokenUsage(data.tokenUsage);
            if (counts) { usageSeen = true; usageIncomplete = false; pending.push({ type: "usage", state: "complete", counts }); }
          }
        } else if (kind === "meteringEvent" || kind === "contextUsageEvent") {
          const details: Record<string, string | number> = {};
          for (const key of ["usage", "unit", "contextUsagePercentage"]) {
            const value = data[key]; if (typeof value === "number" && Number.isFinite(value) || typeof value === "string" && value.length <= 64) details[key] = value;
          }
          diagnostic(`kiro-${kind}`, details);
        } else if (kind === "responsesIgnoredEvent") {
          unknownEvents++;
          const name = typeof data.eventType === "string" ? data.eventType : "unsafe";
          if (ignoredEvents.has(name) || ignoredEvents.size < 16) ignoredEvents.set(name, (ignoredEvents.get(name) ?? 0) + 1);
        } else if (kind !== "responsesControlEvent") unknownEvents++;
        yield* drain(); bounded.throwIfAborted();
      }
      bounded.throwIfAborted(); flushTags(); yield* drain();
      const ignoredEventTypes = Object.fromEntries(ignoredEvents);
      if (incomplete) {
        // KAS 0.66.70 u(): incomplete never releases held tool stops, so no tool from this turn is executable.
        const reasonDetails = { stopReason: incomplete.stopReason, ...(incomplete.reason ? { reason: incomplete.reason } : {}), knownReason: incomplete.known };
        // KAS throws model_handoff here and requires compaction, so this terminal (unlike a mid-stream overflow) may compact and retry.
        if (incomplete.stopReason === "COMPACTION_REQUIRED_FOR_MODEL_HANDOFF") {
          handoff = true; diagnostic("kiro-responses-incomplete", reasonDetails);
          throw new KiroServiceFailure({ stage: "stream", status: response.status, category: "overflow", conflict: false, evidence: "code" }); }
        if (incomplete.stopReason !== "MAX_TOKENS" && tools.size) throw new KiroChatError("Kiro 工具调用流被截断，未执行不完整的工具请求。");
        if (incomplete.stopReason !== "MAX_TOKENS" && !tools.size && !hasText) throw new KiroChatError("Kiro 未返回有效文本或工具调用，不能将空回复或未知事件视为成功。");
        if (!usageSeen) diagnostic("kiro-usage-unavailable", { note: "服务未报告精确 token 用量；零值不是实际用量或免费保证。" });
        diagnostic("kiro-responses-incomplete", { ...reasonDetails, unknownEvents, ignoredEventTypes,
          note: incomplete.stopReason === "MAX_TOKENS" ? "输出达到长度上限；本轮工具调用视为截断，不执行。" : incomplete.stopReason === "CONTENT_FILTERED" ? "服务过滤了剩余内容；已显示部分即服务返回内容。" : "服务以未识别原因结束本轮，按正常结束处理。" });
        yield* drain(); bounded.throwIfAborted();
        yield { type: "done", reason: incomplete.stopReason === "MAX_TOKENS" ? "length" : "stop" };
        return;
      }
      if ([...tools.values()].some(tool => !tool.ended)) throw new KiroChatError("Kiro 工具调用流被截断，未执行不完整的工具请求。");
      if (!tools.size && !hasText) throw new KiroChatError("Kiro 未返回有效文本或工具调用，不能将空回复或未知事件视为成功。");
      if (usageIncomplete) diagnostic("kiro-usage-incomplete", { note: "服务用量快照不完整；保留已知计数，缺失项零值不表示精确计量。" });
      if (!usageSeen) diagnostic("kiro-usage-unavailable", { note: "服务未报告精确 token 用量；零值不是实际用量或免费保证。" });
      if (responses) diagnostic("kiro-responses-completed", { terminalContract: "response.completed", unknownEvents, ignoredEventTypes });
      else diagnostic("kiro-completion-inferred", { policy: "local-eof-policy", terminalContract: "unverified", unknownEvents, unrecognizedStopReasons: unknownStops });
      yield* drain(); bounded.throwIfAborted();
      yield { type: "done", reason: tools.size ? "toolUse" : "stop" };
    } catch (error) {
      const cancelled = options.signal?.aborted || lifetime.signal.aborted;
      const failure = error instanceof KiroServiceFailure ? error.info : undefined;
      const local = error instanceof KiroChatError || error instanceof KiroThinkingError ? kiroLocalFailure(error.message) : undefined;
      diagnostic("kiro-failure", failure ? { ...failure, partial } : { stage, partial, category: bounded.aborted ? "timeout-or-cancel" : "local-or-transport",
        ...(local ? { localCode: local.code } : {}), ...(error instanceof KiroResponsesError ? { protocolCode: error.protocolCode, ...(error.eventType ? { eventType: error.eventType } : {}) } : {}), ...(response ? { status: response.status } : {}) });
      yield* drain();
      yield { type: "error", reason: cancelled ? "aborted" : "error", message: cancelled ? "Kiro 聊天请求已取消。" : partial && !handoff ? kiroPartialFailure + (local ? " " + local.note : "")
        : bounded.aborted ? "Kiro 聊天请求超时，请重试。" : failure ? kiroFailureMessage(failure, false)
        : error instanceof KiroChatError || error instanceof KiroThinkingError ? error.message : "Kiro 聊天网络、响应或请求钩子异常；未回显敏感数据。" };
    } finally { if (response) cancelKiroBody(response); }
  }
  return { stream, dispose() { lifetime.abort(); profiles.clear(); } };
}
