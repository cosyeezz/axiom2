import { randomUUID } from "node:crypto";
import { createAssistantMessageEventStream, parseStreamingJson, getCurrentTools, validateToolArguments, type Api, type AssistantMessage, type Model, type OAuthAuth, type StreamOptions, type ToolCall, type TranscriptContext } from "@earendil-works/pi-ai";
import { createKiroClient } from "../../native-providers/kiro/client.js";
import type { NativeStreamOptions } from "../../native-providers/contracts.js";
import { validateKiroCredential } from "./kiro-catalog.js";
import type { KiroCredential } from "./kiro-auth.js";
import { assertKiroChatModel, normalizeKiroContext, KiroChatError } from "./kiro-chat-protocol.js";
import { kiroLocalFailure } from "./kiro-failure.js";
import { KIRO_CONTINUATION_METADATA } from "./kiro-responses.js";
import { kiroThinkingInput } from "./kiro-thinking.js";
import { kiroRequestUsage } from "./kiro-usage.js";

/** Pi-only auth hand-off, message/event mapping, schema validation and price accounting. */
export function kiroChat(oauth: OAuthAuth, transport?: typeof fetch) {
  const client = createKiroClient(transport);
  const tickets = new Map<string, { account: KiroCredential; expires: number }>();
  const auth: OAuthAuth = { ...oauth, async toAuth(credential) {
    const account = validateKiroCredential(credential), now = Date.now();
    if (account.expires <= now) throw new KiroChatError("Kiro 访问令牌已过期，请刷新认证。");
    for (const [key, value] of tickets) if (value.expires <= now) tickets.delete(key);
    if (tickets.size >= 256) tickets.delete(tickets.keys().next().value!);
    const ticket = "axiom-kiro-native:" + randomUUID();
    // No refresh or registration secret in the hand-off table or upstream API-key slot.
    tickets.set(ticket, { account: { type: "oauth", access: account.access, refresh: "native-handoff",
      expires: account.expires, authMethod: account.authMethod, authRegion: account.authRegion, profileArn: account.profileArn }, expires: now + 60_000 });
    return { apiKey: ticket };
  } };
  function stream(model: Model<Api>, context: TranscriptContext, options: StreamOptions = {}) {
    const output = createAssistantMessageEventStream(), measurement = kiroRequestUsage(model);
    const message: AssistantMessage = { role: "assistant", content: [], api: model.api, provider: model.provider, model: model.id,
      stopReason: "pending", timestamp: Date.now(), usage: measurement.usage };
    void (async () => {
      let textIndex: number | undefined, thinkingIndex: number | undefined;
      const tools = new Map<string, number>();
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
      try {
        options.signal?.throwIfAborted(); assertKiroChatModel(model);
        const ticket = options.apiKey ? tickets.get(options.apiKey) : undefined;
        if (options.apiKey) tickets.delete(options.apiKey);
        if (!ticket || ticket.expires <= Date.now() || ticket.account.expires <= Date.now()) throw new KiroChatError("Kiro 原生认证交接无效或已过期，请重试；不接受通用 API 密钥。");
        const advanced = options as StreamOptions & { toolChoice?: unknown; reasoning?: unknown; thinkingBudgets?: unknown };
        const nativeOptions: NativeStreamOptions = { signal: options.signal, timeoutMs: options.timeoutMs, sessionId: options.sessionId,
          // The native serializer validates this untrusted metadata value, including non-strings.
          continuationId: options.metadata?.[KIRO_CONTINUATION_METADATA] as string | undefined, headers: options.headers, fetch: options.fetch,
          onPayload: payload => options.onPayload?.(payload, model), onResponse: response => options.onResponse?.(response, model),
          onProviderEvent: event => options.onProviderStreamEvent?.(event, model),
          validateToolInput(definition, call) {
            const sdkTool = getCurrentTools(context.messages).find(item => item.name === definition.name);
            if (!sdkTool) throw Error();
            // Component arguments came from validated JSON; Pi uses a narrower JSON index type.
            return validateToolArguments(sdkTool, { type: "toolCall", ...call, arguments: call.arguments as ToolCall["arguments"] });
          } };
        // An own reasoning:undefined is explicit off; absence asks for service defaults.
        for (const key of ["toolChoice", "reasoning", "thinkingBudgets", "temperature", "maxTokens", "samplingParams"] as const)
          if (Object.hasOwn(advanced, key)) nativeOptions[key] = advanced[key];
        for await (const event of client.stream({ model: kiroThinkingInput(model), account: ticket.account, context: normalizeKiroContext(context), options: nativeOptions })) {
          if (event.type === "start") output.push({ type: "start", partial: message });
          else if (event.type === "text") {
            endThinking();
            if (textIndex === undefined) {
              textIndex = message.content.length; message.content.push({ type: "text", text: "" });
              output.push({ type: "text_start", contentIndex: textIndex, partial: message });
            }
            const block = message.content[textIndex]; if (block.type === "text") block.text += event.delta;
            output.push({ type: "text_delta", contentIndex: textIndex, delta: event.delta, partial: message });
          } else if (event.type === "thinking") {
            endText();
            if (thinkingIndex === undefined) {
              thinkingIndex = message.content.length; message.content.push({ type: "thinking", thinking: "" });
              output.push({ type: "thinking_start", contentIndex: thinkingIndex, partial: message });
            }
            const block = message.content[thinkingIndex];
            if (block.type === "thinking") {
              if (event.signature !== undefined) block.thinkingSignature = event.signature;
              if (event.redacted !== undefined) block.redacted = event.redacted;
              if (event.delta !== undefined) {
                block.thinking += event.delta;
                output.push({ type: "thinking_delta", contentIndex: thinkingIndex, delta: event.delta, partial: message });
              }
            }
          } else if (event.type === "thinking-level") message.providerThinkingLevel = event.level;
          else if (event.type === "response-id") message.responseId = event.id;
          else if (event.type === "tool-start") {
            endText(); endThinking();
            const index = message.content.length; tools.set(event.id, index);
            message.content.push({ type: "toolCall", id: event.id, name: event.name, arguments: {} });
            output.push({ type: "toolcall_start", contentIndex: index, partial: message });
          } else if (event.type === "tool-delta" || event.type === "tool-end") {
            endText(); endThinking();
            const index = tools.get(event.type === "tool-end" ? event.call.id : event.id);
            if (index === undefined) throw Error();
            const block = message.content[index] as ToolCall;
            if (event.type === "tool-delta") {
              if (event.preview !== undefined) block.arguments = parseStreamingJson<ToolCall["arguments"]>(event.preview);
              output.push({ type: "toolcall_delta", contentIndex: index, delta: event.delta, partial: message });
            } else {
              block.arguments = event.call.arguments as ToolCall["arguments"];
              output.push({ type: "toolcall_end", contentIndex: index, toolCall: block, partial: message });
            }
          } else if (event.type === "usage") measurement.acceptNative(event.state === "complete" ? event.counts : undefined);
          else if (event.type === "diagnostic") (message.diagnostics ??= []).push(event.diagnostic as NonNullable<AssistantMessage["diagnostics"]>[number]);
          else if (event.type === "done") {
            endText(); endThinking(); message.stopReason = event.reason;
            output.push({ type: "done", reason: event.reason, message });
          } else if (event.type === "error") {
            message.stopReason = event.reason; message.errorMessage = event.message;
            output.push({ type: "error", reason: event.reason, error: message });
          }
        }
      } catch (error) {
        // SDK-boundary failures only. Native errors already arrive as sanitized events.
        const local = error instanceof KiroChatError ? kiroLocalFailure(error.message) : undefined;
        message.stopReason = options.signal?.aborted ? "aborted" : "error";
        (message.diagnostics ??= []).push({ type: "kiro-failure", timestamp: Date.now(), details: { stage: "request", partial: message.content.length > 0,
          category: options.signal?.aborted ? "timeout-or-cancel" : "local-or-transport", ...(local ? { localCode: local.code } : {}) } });
        message.errorMessage = options.signal?.aborted ? "Kiro 聊天请求已取消。" : error instanceof KiroChatError ? error.message : "Kiro 聊天网络、响应或请求钩子异常；未回显敏感数据。";
        output.push({ type: "error", reason: message.stopReason, error: message });
      } finally { output.end(); }
    })();
    return output;
  }
  return { auth, stream };
}
