import { createHash, randomUUID } from "node:crypto";
import { createAssistantMessageEventStream, parseStreamingJson, getCurrentTools, validateToolArguments, type Api, type AssistantMessage, type Model, type OAuthAuth, type StreamOptions, type ToolCall, type TranscriptContext } from "@earendil-works/pi-ai";
import { validateKiroCredential } from "./kiro-catalog.js";
import type { KiroCredential } from "./kiro-auth.js";
import { assertKiroChatModel, KiroChatError, kiroChatEndpoint, kiroChatRequest, kiroObject, kiroText } from "./kiro-chat-protocol.js";
import { classifyKiroFailure, KiroServiceFailure, kiroFailureMessage, kiroLocalFailure, kiroPartialFailure, readKiroErrorBody } from "./kiro-failure.js";
import { readKiroEvents } from "./kiro-eventstream.js";
import { KiroThinkingError, kiroThinkingRequest } from "./kiro-thinking.js";
import { KiroThinkingStream } from "./kiro-thinking-stream.js";
import { KiroToolInput } from "./kiro-tool-input.js";
import { kiroRequestUsage } from "./kiro-usage.js";
import { resolveKiroProfile } from "./kiro-profile.js";

// Hooks and injected transports may ignore signals. Bound our waiting independently;
// a late response is cancelled without allowing it to publish events or retain a body.
function waitForKiro<T>(work: T | PromiseLike<T>, signal: AbortSignal, late?: (value: T) => void): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const abort = () => { if (!settled) { settled = true; signal.removeEventListener("abort", abort); reject(signal.reason); } };
    Promise.resolve(work).then(value => {
      if (settled) { late?.(value); return; }
      settled = true; signal.removeEventListener("abort", abort); resolve(value);
    }, error => {
      if (settled) return;
      settled = true; signal.removeEventListener("abort", abort); reject(error);
    });
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
  });
}
function cancelBody(response: Response) { if (response.body && !response.body.locked) void response.body.cancel().catch(() => {}); }

/** Only an opaque, one-use in-process capability crosses Pi's generic auth pipeline. */
export function kiroChat(oauth: OAuthAuth, transport?: typeof fetch) {
  const tickets = new Map<string, { account: KiroCredential; expires: number }>();
  // Credential-bound, in-memory discovery cache: no token or refresh secret retained.
  const profiles = new Map<string, { arn: string; expires: number }>();
  const auth: OAuthAuth = { ...oauth, async toAuth(credential) {
    const account = validateKiroCredential(credential), now = Date.now();
    if (account.expires <= now) throw new KiroChatError("Kiro 访问令牌已过期，请刷新认证。");
    for (const [key, value] of tickets) if (value.expires <= now) tickets.delete(key);
    if (tickets.size >= 256) tickets.delete(tickets.keys().next().value!);
    const ticket = "axiom-kiro-native:" + randomUUID();
    // Keep no refresh token/registration secret in the hand-off table.
    tickets.set(ticket, { account: { type: "oauth", access: account.access, refresh: "native-handoff",
      expires: account.expires, authMethod: account.authMethod, authRegion: account.authRegion, profileArn: account.profileArn }, expires: now + 60_000 });
    return { apiKey: ticket };
  } };
  function stream(model: Model<Api>, context: TranscriptContext, options: StreamOptions = {}) {
    const output = createAssistantMessageEventStream(), measurement = kiroRequestUsage(model);
    const message: AssistantMessage = { role: "assistant", content: [], api: model.api, provider: model.provider, model: model.id,
      stopReason: "pending", timestamp: Date.now(), usage: measurement.usage };
    void (async () => {
      let response: Response | undefined, usageSeen = false, usageIncomplete = false, partial = false;
      let stage: "request" | "transport" | "response" | "http" | "stream" = "request", unknownEvents = 0, unknownStops = 0;
      const timeout = options.timeoutMs ?? 600_000;
      const bounded = AbortSignal.any([...(options.signal ? [options.signal] : []), AbortSignal.timeout(Number.isSafeInteger(timeout) && timeout > 0 ? Math.min(timeout, 3_600_000) : 600_000)]);
      let textIndex: number | undefined, thinkingIndex: number | undefined;
      const tools = new Map<string, { index: number; input: KiroToolInput; ended: boolean }>();
      const endText = () => {
        if (textIndex === undefined) return;
        const block = message.content[textIndex];
        if (block.type === "text") output.push({ type: "text_end", contentIndex: textIndex, content: block.text, partial: message });
        textIndex = undefined;
      };
      const endThinking = () => {
        if (thinkingIndex === undefined) return;
        const block = message.content[thinkingIndex];
        if (block.type === "thinking") output.push({ type: "thinking_end", contentIndex: thinkingIndex, content: block.thinking, partial: message });
        thinkingIndex = undefined;
      };
      const appendText = (text: string) => {
        endThinking();
        if (textIndex === undefined) {
          textIndex = message.content.length; message.content.push({ type: "text", text: "" });
          output.push({ type: "text_start", contentIndex: textIndex, partial: message });
        }
        const block = message.content[textIndex];
        if (block.type === "text") block.text += text;
        output.push({ type: "text_delta", contentIndex: textIndex, delta: text, partial: message });
      };
      const appendThinking = (text: string) => {
        endText();
        if (thinkingIndex === undefined) {
          thinkingIndex = message.content.length; message.content.push({ type: "thinking", thinking: "" });
          output.push({ type: "thinking_start", contentIndex: thinkingIndex, partial: message });
        }
        const block = message.content[thinkingIndex];
        if (block.type === "thinking") block.thinking += text;
        output.push({ type: "thinking_delta", contentIndex: thinkingIndex, delta: text, partial: message });
      };
      try {
        bounded.throwIfAborted(); assertKiroChatModel(model);
        const advanced = options as StreamOptions & { toolChoice?: unknown; reasoning?: unknown; thinkingBudgets?: unknown };
        if (advanced.toolChoice !== undefined && advanced.toolChoice !== "auto") throw new KiroChatError("Kiro 原生协议当前只支持自动工具选择，不会忽略强制或禁用工具的要求。");
        const ignored = ["temperature", "maxTokens", "samplingParams"].filter(key => (advanced as Record<string, unknown>)[key] !== undefined);
        if (ignored.length) (message.diagnostics ??= []).push({ type: "kiro-unsupported-controls", timestamp: Date.now(), details: { controls: ignored.join(","), note: "未猜测映射这些生成参数，服务使用自身默认值。" } });
        const ticket = options.apiKey ? tickets.get(options.apiKey) : undefined;
        if (options.apiKey) tickets.delete(options.apiKey);
        if (!ticket || ticket.expires <= Date.now() || ticket.account.expires <= Date.now()) throw new KiroChatError("Kiro 原生认证交接无效或已过期，请重试；不接受通用 API 密钥。");
        let account = ticket.account;
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
        const { payload, names, seenCalls, historyNotice, interruptionNotice } = kiroChatRequest(model, context, account, options.sessionId);
        const thinking = kiroThinkingRequest(model, advanced);
        if (thinking) {
          message.providerThinkingLevel = thinking.providerLevel;
          if (thinking.additional) (payload as Record<string, unknown>).additionalModelRequestFields = thinking.additional;
          if (thinking.prefix) {
            const first = [...(payload.conversationState.history ?? []), payload.conversationState.currentMessage].find(item => "userInputMessage" in item);
            if (first && "userInputMessage" in first) first.userInputMessage.content = thinking.prefix + "\n" + first.userInputMessage.content;
          }
        }
        const tagged = thinking?.enabled ? new KiroThinkingStream() : undefined;
        const emitParts = (parts: ReturnType<KiroThinkingStream["push"]>) => {
          for (const part of parts) if (part.type === "thinking") appendThinking(part.text); else appendText(part.text);
        };
        let unclosedReported = false;
        const flushTags = () => {
          if (!tagged) return;
          emitParts(tagged.finish());
          if (tagged.unclosed && !unclosedReported) {
            unclosedReported = true;
            (message.diagnostics ??= []).push({ type: "kiro-thinking-tag-unclosed", timestamp: Date.now(), details: { note: "思考标签未闭合；剩余内容仅按思考显示，不伪造正文或截断原因。" } });
          }
        };
        if (Object.values(historyNotice).some(Boolean)) (message.diagnostics ??= []).push({ type: "kiro-reasoning-history-omitted", timestamp: Date.now(), details: historyNotice });
        if (interruptionNotice.omittedToolCalls) (message.diagnostics ??= []).push({ type: "kiro-interrupted-tools-omitted", timestamp: Date.now(), details: { ...interruptionNotice, executionState: "unknown", userBoundaryProvenance: "unverified", policy: "verify-before-repeating-side-effects" } });
        const replacement = await waitForKiro(options.onPayload?.(payload, model), bounded), request = replacement === undefined ? payload : kiroObject(replacement);
        const state = kiroObject(request.conversationState), current = kiroObject(kiroObject(state.currentMessage).userInputMessage);
        if (request.profileArn !== account.profileArn || current.modelId !== model.id || current.origin !== "KIRO_CLI")
          throw new KiroChatError("Kiro 请求钩子不能替换账号 profile、所选模型 ID 或 CLI origin。");
        const body = JSON.stringify(request);
        if (Buffer.byteLength(body, "utf8") > 10 * 1024 * 1024) throw new KiroChatError("Kiro 聊天请求超过本地 10 MiB 限制；请压缩上下文。");
        bounded.throwIfAborted();
        const headers = new Headers();
        for (const [key, value] of Object.entries(options.headers ?? {})) {
          if (value !== null && !/^(?:authorization|host|cookie|content-.*|accept.*|user-agent|x-amz.*|amz-sdk-.*|tokentype|connection|transfer-encoding)$/i.test(key)) headers.set(key, value);
        }
        headers.set("Authorization", `Bearer ${account.access}`);
        headers.set("Content-Type", "application/x-amz-json-1.0"); headers.set("Accept", "application/vnd.amazon.eventstream");
        headers.set("x-amz-target", "AmazonCodeWhispererStreamingService.GenerateAssistantResponse");
        headers.set("x-amzn-codewhisperer-optout", "true");
        headers.set("amz-sdk-invocation-id", randomUUID()); headers.set("amz-sdk-request", "attempt=1; max=1");
        stage = "transport";
        response = await waitForKiro((options.fetch ?? transport ?? globalThis.fetch)(kiroChatEndpoint(account), { method: "POST", redirect: "error", headers, body, signal: bounded }), bounded, cancelBody);
        bounded.throwIfAborted(); stage = "response";
        await waitForKiro(options.onResponse?.({ status: response.status, headers: Object.fromEntries(response.headers.entries()) }, model), bounded);
        bounded.throwIfAborted();
        if (!response.ok) {
          stage = "http";
          const failureBody = await readKiroErrorBody(response, bounded); bounded.throwIfAborted();
          throw new KiroServiceFailure(classifyKiroFailure({ stage: "http", status: response.status, body: failureBody,
            codes: [response.headers.get("x-amzn-errortype")], requestId: response.headers.get("x-amzn-requestid") ?? response.headers.get("x-amz-request-id") }));
        }
        stage = "stream";
        if (!response.body || !response.headers.get("content-type")?.toLowerCase().startsWith("application/vnd.amazon.eventstream"))
          throw new KiroChatError("Kiro 未返回有效的 AWS event-stream 响应。");
        output.push({ type: "start", partial: message });
        for await (const event of readKiroEvents(response.body, bounded)) {
          const { headers, data } = event, kind = headers[":event-type"];
          // Count upstream progress before hooks/tag buffering, including empty starts.
          if (kind === "assistantResponseEvent" || kind === "reasoningContentEvent" || kind === "toolUseEvent") partial = true;
          await waitForKiro(options.onProviderStreamEvent?.(event, model), bounded); bounded.throwIfAborted();
          if (headers[":message-type"] !== "event") throw new KiroServiceFailure(classifyKiroFailure({ stage: "stream", status: response.status,
            codes: [headers[":exception-type"], headers[":error-code"]], body: { state: "json", data }, requestId: data.requestId }));
          if (kind === "assistantResponseEvent") {
            if (typeof data.content !== "string") throw new KiroChatError("Kiro 文本事件格式无效。");
            if (tagged) emitParts(tagged.push(data.content)); else appendText(data.content);
            if (kiroText(data.messageId)) message.responseId = data.messageId;
          } else if (kind === "reasoningContentEvent") {
            flushTags(); endText();
            if (thinkingIndex === undefined) {
              thinkingIndex = message.content.length; message.content.push({ type: "thinking", thinking: "" });
              output.push({ type: "thinking_start", contentIndex: thinkingIndex, partial: message });
            }
            const block = message.content[thinkingIndex];
            if (block.type !== "thinking" || data.text !== undefined && typeof data.text !== "string" || data.signature !== undefined && typeof data.signature !== "string" || data.redactedContent !== undefined && typeof data.redactedContent !== "string") throw new KiroChatError("Kiro 思考事件格式无效。");
            if (typeof data.text === "string") { block.thinking += data.text; output.push({ type: "thinking_delta", contentIndex: thinkingIndex, delta: data.text, partial: message }); }
            if (typeof data.signature === "string") block.thinkingSignature = data.signature;
            if (typeof data.redactedContent === "string") { block.redacted = true; block.thinkingSignature = data.redactedContent; }
          } else if (kind === "toolUseEvent") {
            flushTags(); endText(); endThinking();
            if (!kiroText(data.toolUseId, 256) || data.input !== undefined && typeof data.input !== "string" || data.stop !== undefined && typeof data.stop !== "boolean") throw new KiroChatError("Kiro 工具事件格式无效。");
            let tool = tools.get(data.toolUseId);
            if (!tool) {
              if (seenCalls.has(data.toolUseId)) throw new KiroChatError("Kiro 工具调用 ID 与既有历史重复；未执行该工具。");
              if (!kiroText(data.name, 64) || !names.has(data.name) || tools.size >= 1024) throw new KiroChatError("Kiro 返回了未声明、无效或过多的工具调用。");
              tool = { index: message.content.length, input: new KiroToolInput(), ended: false }; tools.set(data.toolUseId, tool);
              message.content.push({ type: "toolCall", id: data.toolUseId, name: names.get(data.name)!, arguments: {} });
              output.push({ type: "toolcall_start", contentIndex: tool.index, partial: message });
            }
            const block = message.content[tool.index] as ToolCall;
            if (tool.ended || data.name !== undefined && names.get(String(data.name)) !== block.name) throw new KiroChatError("Kiro 工具调用重复结束或名称发生变化。");
            if (typeof data.input === "string") {
              tool.input.append(data.input);
              const preview = data.stop === true ? undefined : tool.input.preview();
              if (preview !== undefined) block.arguments = parseStreamingJson<ToolCall["arguments"]>(preview);
              output.push({ type: "toolcall_delta", contentIndex: tool.index, delta: data.input, partial: message });
            }
            if (data.stop === true) {
              bounded.throwIfAborted();
              try { block.arguments = kiroObject(JSON.parse(tool.input.complete() || "{}")) as ToolCall["arguments"]; }
              catch { throw new KiroChatError("Kiro 工具参数 JSON 无效或被截断；未执行该工具。"); }
              try {
                const definition = getCurrentTools(context.messages).find(item => item.name === block.name);
                if (!definition) throw Error();
                const validated = validateToolArguments(definition, block) as ToolCall["arguments"];
                // Pi permits coercion for generic providers. Native tool execution must use
                // exactly the JSON supplied by this stream, not a silently repaired value.
                if (JSON.stringify(validated) !== JSON.stringify(block.arguments)) throw Error();
              } catch { throw new KiroChatError("Kiro 工具参数不符合声明的 JSON Schema；未执行该工具。"); }
              bounded.throwIfAborted();
              tool.ended = true; output.push({ type: "toolcall_end", contentIndex: tool.index, toolCall: block, partial: message });
            }
          } else if (kind === "metadataEvent") {
            if (data.stopReason === "CONTENT_FILTERED") throw new KiroChatError("Kiro 服务拦截了当前内容，未将拒答伪装为空回复。");
            if (Object.hasOwn(data, "stopReason")) unknownStops++;
            if (Object.hasOwn(data, "tokenUsage")) {
              usageIncomplete = !measurement.accept(data.tokenUsage);
              if (!usageIncomplete) usageSeen = true;
            }
          } else if (kind === "meteringEvent" || kind === "contextUsageEvent") {
            // Credits/percentages are not token counts or dollar prices. Preserve only bounded scalars.
            const details: Record<string, string | number> = {};
            for (const key of ["usage", "unit", "contextUsagePercentage"]) {
              const value = data[key]; if (typeof value === "number" && Number.isFinite(value) || typeof value === "string" && value.length <= 64) details[key] = value;
            }
            (message.diagnostics ??= []).push({ type: `kiro-${kind}`, timestamp: Date.now(), details });
          } else unknownEvents++;
        }
        bounded.throwIfAborted(); flushTags(); endText(); endThinking();
        if ([...tools.values()].some(tool => !tool.ended)) throw new KiroChatError("Kiro 工具调用流被截断，未执行不完整的工具请求。");
        if (!tools.size && !message.content.some(block => block.type === "text" && !!block.text.trim())) throw new KiroChatError("Kiro 未返回有效文本或工具调用，不能将空回复或未知事件视为成功。");
        if (usageIncomplete) (message.diagnostics ??= []).push({ type: "kiro-usage-incomplete", timestamp: Date.now(), details: { note: "服务用量快照不完整；保留已知计数，缺失项零值不表示精确计量。" } });
        if (!usageSeen) (message.diagnostics ??= []).push({ type: "kiro-usage-unavailable", timestamp: Date.now(), details: { note: "服务未报告精确 token 用量；零值不是实际用量或免费保证。" } });
        (message.diagnostics ??= []).push({ type: "kiro-completion-inferred", timestamp: Date.now(),
          details: { policy: "local-eof-policy", terminalContract: "unverified", unknownEvents, unrecognizedStopReasons: unknownStops } });
        message.stopReason = tools.size ? "toolUse" : "stop";
        output.push({ type: "done", reason: message.stopReason, message });
      } catch (error) {
        message.stopReason = options.signal?.aborted ? "aborted" : "error";
        const failure = error instanceof KiroServiceFailure ? error.info : undefined;
        const local = error instanceof KiroChatError || error instanceof KiroThinkingError ? kiroLocalFailure(error.message) : undefined;
        (message.diagnostics ??= []).push({ type: "kiro-failure", timestamp: Date.now(), details: failure ? { ...failure, partial }
          : { stage, partial, category: bounded.aborted ? "timeout-or-cancel" : "local-or-transport", ...(local ? { localCode: local.code } : {}), ...(response ? { status: response.status } : {}) } });
        message.errorMessage = options.signal?.aborted ? "Kiro 聊天请求已取消。" : partial ? kiroPartialFailure + (local ? " " + local.note : "")
          : bounded.aborted ? "Kiro 聊天请求超时，请重试。" : failure ? kiroFailureMessage(failure, false)
          : error instanceof KiroChatError || error instanceof KiroThinkingError ? error.message : "Kiro 聊天网络、响应或请求钩子异常；未回显敏感数据。";
        output.push({ type: "error", reason: message.stopReason, error: message });
      } finally {
        if (response) cancelBody(response);
        output.end();
      }
    })();
    return output;
  }
  return { auth, stream };
}
