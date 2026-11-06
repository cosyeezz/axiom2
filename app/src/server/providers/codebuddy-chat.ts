import { randomUUID } from "node:crypto";
import { calculateCost, collapseSystemMessages, createAssistantMessageEventStream, getCurrentSystemPrompt, getCurrentTools, parseStreamingJson, validateToolArguments,
  type Api, type AssistantMessage, type Model, type ProviderAuth, type StreamOptions, type ToolCall, type TranscriptContext } from "@earendil-works/pi-ai";
import { createCodeBuddyClient } from "../../native-providers/codebuddy/client.js";
import { CodeBuddyProtocolError } from "../../native-providers/codebuddy/failure.js";
import { validCodeBuddyToken } from "../../native-providers/codebuddy/json.js";
import { codeBuddyBaseUrl, codeBuddyId } from "../../native-providers/codebuddy/identity.js";
import { createCodeBuddyIdentityScope } from "../../native-providers/codebuddy/ids.js";
import type { CodeBuddyStreamOptions } from "../../native-providers/codebuddy/request.js";
import type { NativeContext, NativeModel } from "../../native-providers/contracts.js";

import { CODEBUDDY_CONTINUATION_METADATA, CODEBUDDY_IDENTITY_METADATA } from "../codebuddy-run-identity.js";
export { CODEBUDDY_CONTINUATION_METADATA, CODEBUDDY_IDENTITY_METADATA } from "../codebuddy-run-identity.js";
export const CODEBUDDY_TICKET_PREFIX = "axiom-codebuddy-native:";
export function assertCodeBuddyChatModel(model: Model<Api>) {
  if (model.provider !== codeBuddyId || model.api !== "openai-completions" || ![codeBuddyBaseUrl, `${codeBuddyBaseUrl}/`].includes(model.baseUrl))
    throw new CodeBuddyProtocolError("target");
}

/** Pi boundary only; no protocol serializer, network retry or tool execution lives here. */
export function codeBuddyChat(auth: ProviderAuth, transport?: typeof fetch) {
  let client = createCodeBuddyClient(transport);
  const identities = createCodeBuddyIdentityScope();
  let disposed = false;
  const tickets = new Map<string, { access: string; expires: number }>();
  const issue = (access: string, expires = Infinity) => {
    const now = Date.now();
    if (disposed || !validCodeBuddyToken(access) || expires <= now) throw new CodeBuddyProtocolError("request");
    for (const [key, entry] of tickets) if (entry.expires <= now) tickets.delete(key);
    if (tickets.size >= 256) tickets.delete(tickets.keys().next().value!);
    const key = CODEBUDDY_TICKET_PREFIX + randomUUID(); tickets.set(key, { access, expires: Math.min(now + 60000, expires) });
    return key;
  };
  const consumeAccess = (key: string | undefined) => {
    if (disposed) throw new CodeBuddyProtocolError("request");
    let access = key;
    if (access?.startsWith(CODEBUDDY_TICKET_PREFIX)) {
      const ticket = tickets.get(access); tickets.delete(access);
      if (!ticket || ticket.expires <= Date.now()) throw new CodeBuddyProtocolError("request"); access = ticket.access;
    }
    if (!validCodeBuddyToken(access)) throw new CodeBuddyProtocolError("request");
    return access;
  };
  const wrappedAuth: ProviderAuth = {
    ...(auth.oauth ? { oauth: { ...auth.oauth, async toAuth(credential) { return { apiKey: issue(credential.access, credential.expires) }; } } } : {}),
    ...(auth.apiKey ? { apiKey: { ...auth.apiKey,
      async check(input) {
        if (auth.apiKey!.check) return auth.apiKey!.check(input);
        const resolved = await auth.apiKey!.resolve(input);
        return resolved?.auth.apiKey ? { type: "api_key" as const, source: resolved.source } : undefined;
      },
      async resolve(input) {
      const resolved = await auth.apiKey!.resolve(input);
      if (!resolved) return undefined;
      if (!resolved.auth.apiKey) throw new CodeBuddyProtocolError("request");
      return { ...resolved, auth: { ...resolved.auth, apiKey: issue(resolved.auth.apiKey) } };
    } } } : {}),
  };
  function stream(model: Model<Api>, transcript: TranscriptContext, options: StreamOptions = {}) {
    const output = createAssistantMessageEventStream();
    const message: AssistantMessage = { role: "assistant", content: [], api: model.api, provider: model.provider, model: model.id,
      stopReason: "pending", timestamp: Date.now(), usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
    void (async () => {
      let textIndex: number | undefined, thinkingIndex: number | undefined;
      const tools = new Map<string, { index: number; json: string }>();
      const endText = () => {
        if (textIndex === undefined) return;
        const block = message.content[textIndex]; if (block.type === "text") output.push({ type: "text_end", contentIndex: textIndex, content: block.text, partial: message });
        textIndex = undefined;
      };
      const endThinking = () => {
        if (thinkingIndex === undefined) return;
        const block = message.content[thinkingIndex]; if (block.type === "thinking") output.push({ type: "thinking_end", contentIndex: thinkingIndex, content: block.thinking, partial: message });
        thinkingIndex = undefined;
      };
      try {
        options.signal?.throwIfAborted(); assertCodeBuddyChatModel(model);
        // Explicit caller API tokens remain supported, but only AFTER fixed native model/endpoint validation.
        const access = consumeAccess(options.apiKey);
        const collapsed = collapseSystemMessages(transcript), declarations = getCurrentTools(collapsed.messages);
        for (const tool of declarations) {
          if (tool.constrainedSampling && (tool.constrainedSampling.type !== "json_schema" || tool.constrainedSampling.strict === "require")) throw new CodeBuddyProtocolError("tool");
          if (tool.constrainedSampling) (message.diagnostics ??= []).push({ type: "codebuddy-constrained-sampling", timestamp: Date.now(), details: { policy: "local-schema-validation-only" } });
        }
        for (const item of collapsed.messages) if (item.role === "assistant") for (const block of item.content) {
          if (block.type === "toolCall" && (block.namespace !== undefined || block.argumentsError !== undefined) || block.type === "thinking" && (block.redacted || block.thinkingSignature !== undefined))
            throw new CodeBuddyProtocolError("request");
        }
        if (options.cacheRetention !== undefined || options.transport !== undefined && options.transport !== "sse" && options.transport !== "auto" || options.websocketConnectTimeoutMs !== undefined)
          throw new CodeBuddyProtocolError("request");
        const context: NativeContext = { systemPrompt: getCurrentSystemPrompt(collapsed.messages), tools: declarations, messages: collapsed.messages.filter(item => item.role !== "system") };
        const nativeModel: NativeModel = { id: model.id, name: model.name, contextWindow: model.contextWindow, maxOutputTokens: model.maxTokens,
          input: [...model.input], thinking: { supported: model.reasoning, levels: model.thinkingLevelMap } };
        const advanced = options as StreamOptions & { reasoning?: unknown; reasoningEffort?: unknown; toolChoice?: unknown; thinkingBudgets?: unknown };
        if (advanced.reasoningEffort !== undefined && advanced.reasoning !== undefined && advanced.reasoningEffort !== advanced.reasoning) throw new CodeBuddyProtocolError("thinking");
        const reasoning = advanced.reasoningEffort ?? advanced.reasoning;
        const level = (reasoning ?? "off") as keyof NonNullable<Model<Api>["samplingParamsByThinkingLevel"]>;
        // Caller named settings override model defaults; caller wire sampling remains most specific.
        const sampling = { ...model.samplingParams, ...model.samplingParamsByThinkingLevel?.[level],
          ...(options.temperature !== undefined ? { temperature: options.temperature } : {}),
          ...(options.maxTokens !== undefined ? { max_tokens: options.maxTokens } : {}), ...options.samplingParams };
        const temperature = sampling.temperature;
        const maxTokens = sampling.max_tokens;
        if (options.maxTokens !== undefined && typeof maxTokens === "number" && maxTokens > options.maxTokens) throw new CodeBuddyProtocolError("request");
        delete sampling.temperature; delete sampling.max_tokens;
        const run = options.metadata?.[CODEBUDDY_CONTINUATION_METADATA];
        // Host session/run values are local lookup keys, never protocol identities.
        // No arbitrary host metadata may populate CLI identity/agent/runtime headers.
        if (options.metadata?.[CODEBUDDY_IDENTITY_METADATA] !== undefined ||
          options.sessionId !== undefined && (typeof options.sessionId !== "string" || !options.sessionId) ||
          run !== undefined && (typeof run !== "string" || !run)) throw new CodeBuddyProtocolError("request");
        const ownedIdentity = identities.resolve(options.sessionId, run as string | undefined);
        const nativeOptions: CodeBuddyStreamOptions = { signal: options.signal, timeoutMs: options.timeoutMs, ...ownedIdentity,
          headers: options.headers, fetch: options.fetch, reasoning,
          temperature, maxTokens, samplingParams: sampling,
          toolChoice: advanced.toolChoice, thinkingBudgets: advanced.thinkingBudgets,
          onPayload: payload => options.onPayload?.(payload, model), onResponse: response => options.onResponse?.(response, model), onProviderEvent: event => options.onProviderStreamEvent?.(event, model),
          validateToolInput(definition, call) {
            const tool = declarations.find(item => item.name === definition.name); if (!tool) throw Error();
            return validateToolArguments(tool, { type: "toolCall", ...call, arguments: call.arguments as ToolCall["arguments"] });
          } };
        for await (const event of client.stream({ model: nativeModel, access, context, options: nativeOptions })) {
          if (event.type === "start") output.push({ type: "start", partial: message });
          else if (event.type === "text") {
            endThinking();
            if (textIndex === undefined) { textIndex = message.content.length; message.content.push({ type: "text", text: "" }); output.push({ type: "text_start", contentIndex: textIndex, partial: message }); }
            const block = message.content[textIndex]; if (block.type === "text") block.text += event.delta;
            output.push({ type: "text_delta", contentIndex: textIndex, delta: event.delta, partial: message });
          } else if (event.type === "thinking") {
            endText();
            if (thinkingIndex === undefined) { thinkingIndex = message.content.length; message.content.push({ type: "thinking", thinking: "" }); output.push({ type: "thinking_start", contentIndex: thinkingIndex, partial: message }); }
            const block = message.content[thinkingIndex]; if (block.type === "thinking" && event.delta !== undefined) { block.thinking += event.delta; output.push({ type: "thinking_delta", contentIndex: thinkingIndex, delta: event.delta, partial: message }); }
          } else if (event.type === "response-id") message.responseId = event.id;
          else if (event.type === "thinking-level") message.providerThinkingLevel = event.level;
          else if (event.type === "tool-start") {
            endText(); endThinking(); const index = message.content.length; tools.set(event.id, { index, json: "" });
            message.content.push({ type: "toolCall", id: event.id, name: event.name, arguments: {} }); output.push({ type: "toolcall_start", contentIndex: index, partial: message });
          } else if (event.type === "tool-delta" || event.type === "tool-end") {
            endText(); endThinking(); const tool = tools.get(event.type === "tool-end" ? event.call.id : event.id); if (!tool) throw Error();
            const block = message.content[tool.index] as ToolCall;
            if (event.type === "tool-delta") { tool.json += event.delta; block.arguments = parseStreamingJson<ToolCall["arguments"]>(tool.json); output.push({ type: "toolcall_delta", contentIndex: tool.index, delta: event.delta, partial: message }); }
            else { block.arguments = event.call.arguments as ToolCall["arguments"]; output.push({ type: "toolcall_end", contentIndex: tool.index, toolCall: block, partial: message }); }
          } else if (event.type === "usage" && event.state === "complete") {
            Object.assign(message.usage, event.counts);
            calculateCost(model, message.usage);
            if (!Object.values(message.usage.cost).every(value => Number.isFinite(value) && value >= 0)) message.usage.cost = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 };
          } else if (event.type === "diagnostic") (message.diagnostics ??= []).push(event.diagnostic as NonNullable<AssistantMessage["diagnostics"]>[number]);
          else if (event.type === "done") { endText(); endThinking(); message.stopReason = event.reason; output.push({ type: "done", reason: event.reason, message }); }
          else if (event.type === "error") { message.stopReason = event.reason; message.errorMessage = event.message; output.push({ type: "error", reason: event.reason, error: message }); }
        }
      } catch (error) {
        message.stopReason = options.signal?.aborted ? "aborted" : "error";
        message.errorMessage = options.signal?.aborted ? "CodeBuddy 请求已取消。" : error instanceof CodeBuddyProtocolError ? error.message : "CodeBuddy SDK 适配或认证异常；未回显敏感数据。";
        output.push({ type: "error", reason: message.stopReason, error: message });
      } finally { output.end(); }
    })();
    return output;
  }
  return { auth: wrappedAuth, stream, consumeAccess,
    invalidate() { tickets.clear(); identities.clear(); client.dispose(); if (!disposed) client = createCodeBuddyClient(transport); },
    dispose() { disposed = true; tickets.clear(); identities.clear(); client.dispose(); } };

}
