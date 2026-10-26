import { randomUUID } from "node:crypto";
import { createAssistantMessageEventStream, parseStreamingJson, getCurrentTools, validateToolArguments } from "@earendil-works/pi-ai";
import { validateKiroCredential } from "./kiro-catalog.js";
import { assertKiroChatModel, KiroChatError, kiroChatEndpoint, kiroChatFailure, kiroChatRequest, kiroObject, kiroStreamFailure, kiroText } from "./kiro-chat-protocol.js";
import { readKiroEvents } from "./kiro-eventstream.js";
import { KiroThinkingError, kiroThinkingRequest } from "./kiro-thinking.js";
import { KiroThinkingStream } from "./kiro-thinking-stream.js";
// Hooks and injected transports may ignore signals. Bound our waiting independently;
// a late response is cancelled without allowing it to publish events or retain a body.
function waitForKiro(work, signal, late) {
    return new Promise((resolve, reject) => {
        let settled = false;
        const abort = () => { if (!settled) {
            settled = true;
            signal.removeEventListener("abort", abort);
            reject(signal.reason);
        } };
        Promise.resolve(work).then(value => {
            if (settled) {
                late?.(value);
                return;
            }
            settled = true;
            signal.removeEventListener("abort", abort);
            resolve(value);
        }, error => {
            if (settled)
                return;
            settled = true;
            signal.removeEventListener("abort", abort);
            reject(error);
        });
        signal.addEventListener("abort", abort, { once: true });
        if (signal.aborted)
            abort();
    });
}
function cancelBody(response) { if (response.body && !response.body.locked)
    void response.body.cancel().catch(() => { }); }
/** Only an opaque, one-use in-process capability crosses Pi's generic auth pipeline. */
export function kiroChat(oauth, transport) {
    const tickets = new Map();
    const auth = { ...oauth, async toAuth(credential) {
            const account = validateKiroCredential(credential), now = Date.now();
            if (account.expires <= now)
                throw new KiroChatError("Kiro 访问令牌已过期，请刷新认证。");
            for (const [key, value] of tickets)
                if (value.expires <= now)
                    tickets.delete(key);
            if (tickets.size >= 256)
                tickets.delete(tickets.keys().next().value);
            const ticket = "axiom-kiro-native:" + randomUUID();
            // Keep no refresh token/registration secret in the hand-off table.
            tickets.set(ticket, { account: { type: "oauth", access: account.access, refresh: "native-handoff",
                    expires: account.expires, authMethod: account.authMethod, authRegion: account.authRegion, profileArn: account.profileArn }, expires: now + 60_000 });
            return { apiKey: ticket };
        } };
    function stream(model, context, options = {}) {
        const output = createAssistantMessageEventStream();
        const message = { role: "assistant", content: [], api: model.api, provider: model.provider, model: model.id,
            stopReason: "pending", timestamp: Date.now(), usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
                cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
        void (async () => {
            let response, usageSeen = false, usageIncomplete = false;
            const timeout = options.timeoutMs ?? 600_000;
            const bounded = AbortSignal.any([...(options.signal ? [options.signal] : []), AbortSignal.timeout(Number.isSafeInteger(timeout) && timeout > 0 ? Math.min(timeout, 3_600_000) : 600_000)]);
            let textIndex, thinkingIndex;
            const tools = new Map();
            const endText = () => {
                if (textIndex === undefined)
                    return;
                const block = message.content[textIndex];
                if (block.type === "text")
                    output.push({ type: "text_end", contentIndex: textIndex, content: block.text, partial: message });
                textIndex = undefined;
            };
            const endThinking = () => {
                if (thinkingIndex === undefined)
                    return;
                const block = message.content[thinkingIndex];
                if (block.type === "thinking")
                    output.push({ type: "thinking_end", contentIndex: thinkingIndex, content: block.thinking, partial: message });
                thinkingIndex = undefined;
            };
            const appendText = (text) => {
                endThinking();
                if (textIndex === undefined) {
                    textIndex = message.content.length;
                    message.content.push({ type: "text", text: "" });
                    output.push({ type: "text_start", contentIndex: textIndex, partial: message });
                }
                const block = message.content[textIndex];
                if (block.type === "text")
                    block.text += text;
                output.push({ type: "text_delta", contentIndex: textIndex, delta: text, partial: message });
            };
            const appendThinking = (text) => {
                endText();
                if (thinkingIndex === undefined) {
                    thinkingIndex = message.content.length;
                    message.content.push({ type: "thinking", thinking: "" });
                    output.push({ type: "thinking_start", contentIndex: thinkingIndex, partial: message });
                }
                const block = message.content[thinkingIndex];
                if (block.type === "thinking")
                    block.thinking += text;
                output.push({ type: "thinking_delta", contentIndex: thinkingIndex, delta: text, partial: message });
            };
            try {
                bounded.throwIfAborted();
                assertKiroChatModel(model);
                const advanced = options;
                if (advanced.toolChoice !== undefined && advanced.toolChoice !== "auto")
                    throw new KiroChatError("Kiro 原生协议当前只支持自动工具选择，不会忽略强制或禁用工具的要求。");
                const ignored = ["temperature", "maxTokens", "samplingParams"].filter(key => advanced[key] !== undefined);
                if (ignored.length)
                    (message.diagnostics ??= []).push({ type: "kiro-unsupported-controls", timestamp: Date.now(), details: { controls: ignored.join(","), note: "未猜测映射这些生成参数，服务使用自身默认值。" } });
                const ticket = options.apiKey ? tickets.get(options.apiKey) : undefined;
                if (options.apiKey)
                    tickets.delete(options.apiKey);
                if (!ticket || ticket.expires <= Date.now() || ticket.account.expires <= Date.now())
                    throw new KiroChatError("Kiro 原生认证交接无效或已过期，请重试；不接受通用 API 密钥。");
                const account = ticket.account, { payload, names, seenCalls, historyNotice, interruptionNotice } = kiroChatRequest(model, context, account, options.sessionId);
                const thinking = kiroThinkingRequest(model, advanced);
                if (thinking) {
                    message.providerThinkingLevel = thinking.providerLevel;
                    if (thinking.additional)
                        payload.additionalModelRequestFields = thinking.additional;
                    if (thinking.prefix) {
                        const first = [...(payload.conversationState.history ?? []), payload.conversationState.currentMessage].find(item => "userInputMessage" in item);
                        if (first && "userInputMessage" in first)
                            first.userInputMessage.content = thinking.prefix + "\n" + first.userInputMessage.content;
                    }
                }
                const tagged = thinking?.enabled ? new KiroThinkingStream() : undefined;
                const emitParts = (parts) => {
                    for (const part of parts)
                        if (part.type === "thinking")
                            appendThinking(part.text);
                        else
                            appendText(part.text);
                };
                let unclosedReported = false;
                const flushTags = () => {
                    if (!tagged)
                        return;
                    emitParts(tagged.finish());
                    if (tagged.unclosed && !unclosedReported) {
                        unclosedReported = true;
                        (message.diagnostics ??= []).push({ type: "kiro-thinking-tag-unclosed", timestamp: Date.now(), details: { note: "思考标签未闭合；剩余内容仅按思考显示，不伪造正文或截断原因。" } });
                    }
                };
                if (Object.values(historyNotice).some(Boolean))
                    (message.diagnostics ??= []).push({ type: "kiro-reasoning-history-omitted", timestamp: Date.now(), details: historyNotice });
                if (interruptionNotice.omittedToolCalls)
                    (message.diagnostics ??= []).push({ type: "kiro-interrupted-tools-omitted", timestamp: Date.now(), details: interruptionNotice });
                const replacement = await waitForKiro(options.onPayload?.(payload, model), bounded), request = replacement === undefined ? payload : kiroObject(replacement);
                const state = kiroObject(request.conversationState), current = kiroObject(kiroObject(state.currentMessage).userInputMessage);
                if (request.profileArn !== account.profileArn || current.modelId !== model.id || current.origin !== "KIRO_CLI")
                    throw new KiroChatError("Kiro 请求钩子不能替换账号 profile、所选模型 ID 或 CLI origin。");
                const body = JSON.stringify(request);
                if (Buffer.byteLength(body, "utf8") > 10 * 1024 * 1024)
                    throw new KiroChatError("Kiro 聊天请求超过本地 10 MiB 限制；请压缩上下文。");
                bounded.throwIfAborted();
                const headers = new Headers();
                for (const [key, value] of Object.entries(options.headers ?? {})) {
                    if (value !== null && !/^(?:authorization|host|cookie|content-.*|accept.*|user-agent|x-amz.*|amz-sdk-.*|tokentype|connection|transfer-encoding)$/i.test(key))
                        headers.set(key, value);
                }
                headers.set("Authorization", `Bearer ${account.access}`);
                headers.set("Content-Type", "application/x-amz-json-1.0");
                headers.set("Accept", "application/vnd.amazon.eventstream");
                headers.set("x-amz-target", "AmazonCodeWhispererStreamingService.GenerateAssistantResponse");
                headers.set("x-amzn-codewhisperer-optout", "true");
                headers.set("User-Agent", "Axiom KiroChat/1.0");
                headers.set("amz-sdk-invocation-id", randomUUID());
                headers.set("amz-sdk-request", "attempt=1; max=1");
                response = await waitForKiro((options.fetch ?? transport ?? globalThis.fetch)(kiroChatEndpoint(account), { method: "POST", redirect: "error", headers, body, signal: bounded }), bounded, cancelBody);
                bounded.throwIfAborted();
                await waitForKiro(options.onResponse?.({ status: response.status, headers: Object.fromEntries(response.headers.entries()) }, model), bounded);
                bounded.throwIfAborted();
                if (!response.ok)
                    throw kiroChatFailure(response.status);
                if (!response.body || !response.headers.get("content-type")?.toLowerCase().startsWith("application/vnd.amazon.eventstream"))
                    throw new KiroChatError("Kiro 未返回有效的 AWS event-stream 响应。");
                output.push({ type: "start", partial: message });
                for await (const event of readKiroEvents(response.body, bounded)) {
                    await waitForKiro(options.onProviderStreamEvent?.(event, model), bounded);
                    bounded.throwIfAborted();
                    const { headers, data } = event, kind = headers[":event-type"];
                    if (headers[":message-type"] !== "event")
                        throw kiroStreamFailure(headers[":exception-type"] ?? headers[":error-code"]);
                    if (kind === "assistantResponseEvent") {
                        if (typeof data.content !== "string")
                            throw new KiroChatError("Kiro 文本事件格式无效。");
                        if (tagged)
                            emitParts(tagged.push(data.content));
                        else
                            appendText(data.content);
                        if (kiroText(data.messageId))
                            message.responseId = data.messageId;
                    }
                    else if (kind === "reasoningContentEvent") {
                        flushTags();
                        endText();
                        if (thinkingIndex === undefined) {
                            thinkingIndex = message.content.length;
                            message.content.push({ type: "thinking", thinking: "" });
                            output.push({ type: "thinking_start", contentIndex: thinkingIndex, partial: message });
                        }
                        const block = message.content[thinkingIndex];
                        if (block.type !== "thinking" || data.text !== undefined && typeof data.text !== "string" || data.signature !== undefined && typeof data.signature !== "string" || data.redactedContent !== undefined && typeof data.redactedContent !== "string")
                            throw new KiroChatError("Kiro 思考事件格式无效。");
                        if (typeof data.text === "string") {
                            block.thinking += data.text;
                            output.push({ type: "thinking_delta", contentIndex: thinkingIndex, delta: data.text, partial: message });
                        }
                        if (typeof data.signature === "string")
                            block.thinkingSignature = data.signature;
                        if (typeof data.redactedContent === "string") {
                            block.redacted = true;
                            block.thinkingSignature = data.redactedContent;
                        }
                    }
                    else if (kind === "toolUseEvent") {
                        flushTags();
                        endText();
                        endThinking();
                        if (!kiroText(data.toolUseId, 256) || data.input !== undefined && typeof data.input !== "string" || data.stop !== undefined && typeof data.stop !== "boolean")
                            throw new KiroChatError("Kiro 工具事件格式无效。");
                        let tool = tools.get(data.toolUseId);
                        if (!tool) {
                            if (seenCalls.has(data.toolUseId))
                                throw new KiroChatError("Kiro 工具调用 ID 与既有历史重复；未执行该工具。");
                            if (!kiroText(data.name, 64) || !names.has(data.name) || tools.size >= 1024)
                                throw new KiroChatError("Kiro 返回了未声明、无效或过多的工具调用。");
                            tool = { index: message.content.length, input: "", ended: false };
                            tools.set(data.toolUseId, tool);
                            message.content.push({ type: "toolCall", id: data.toolUseId, name: names.get(data.name), arguments: {} });
                            output.push({ type: "toolcall_start", contentIndex: tool.index, partial: message });
                        }
                        const block = message.content[tool.index];
                        if (tool.ended || data.name !== undefined && names.get(String(data.name)) !== block.name)
                            throw new KiroChatError("Kiro 工具调用重复结束或名称发生变化。");
                        if (typeof data.input === "string") {
                            tool.input += data.input;
                            if (Buffer.byteLength(tool.input) > 1024 * 1024)
                                throw new KiroChatError("Kiro 工具参数超过本地 1 MiB 限制。");
                            block.arguments = parseStreamingJson(tool.input);
                            output.push({ type: "toolcall_delta", contentIndex: tool.index, delta: data.input, partial: message });
                        }
                        if (data.stop === true) {
                            try {
                                block.arguments = kiroObject(JSON.parse(tool.input || "{}"));
                            }
                            catch {
                                throw new KiroChatError("Kiro 工具参数 JSON 无效或被截断；未执行该工具。");
                            }
                            try {
                                const definition = getCurrentTools(context.messages).find(item => item.name === block.name);
                                if (!definition)
                                    throw Error();
                                const validated = validateToolArguments(definition, block);
                                // Pi permits coercion for generic providers. Native tool execution must use
                                // exactly the JSON supplied by this stream, not a silently repaired value.
                                if (JSON.stringify(validated) !== JSON.stringify(block.arguments))
                                    throw Error();
                            }
                            catch {
                                throw new KiroChatError("Kiro 工具参数不符合声明的 JSON Schema；未执行该工具。");
                            }
                            tool.ended = true;
                            output.push({ type: "toolcall_end", contentIndex: tool.index, toolCall: block, partial: message });
                        }
                    }
                    else if (kind === "metadataEvent") {
                        if (data.stopReason === "CONTENT_FILTERED")
                            throw new KiroChatError("Kiro 服务拦截了当前内容，未将拒答伪装为空回复。");
                        if (data.tokenUsage != null) {
                            const usage = kiroObject(data.tokenUsage);
                            const count = (key) => { const value = usage[key] ?? 0; if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0 || value > 1_000_000_000)
                                throw new KiroChatError("Kiro token 用量格式无效。"); return value; };
                            // Validate every present field, but do not replace a valid snapshot with
                            // an empty/partial one or pretend absent primary counters are precise zero.
                            for (const key of ["uncachedInputTokens", "outputTokens", "cacheReadInputTokens", "cacheWriteInputTokens", "totalTokens"])
                                if (usage[key] != null)
                                    count(key);
                            usageIncomplete = ["uncachedInputTokens", "outputTokens", "cacheReadInputTokens", "cacheWriteInputTokens"].some(key => usage[key] == null);
                            if (!usageIncomplete) {
                                message.usage.input = count("uncachedInputTokens");
                                message.usage.output = count("outputTokens");
                                message.usage.cacheRead = count("cacheReadInputTokens");
                                message.usage.cacheWrite = count("cacheWriteInputTokens");
                                const total = message.usage.input + message.usage.output + message.usage.cacheRead + message.usage.cacheWrite;
                                if (usage.totalTokens != null && count("totalTokens") !== total)
                                    throw new KiroChatError("Kiro token 用量总计与分项不一致。");
                                message.usage.totalTokens = total;
                                usageSeen = true;
                            }
                        }
                    }
                    else if (kind === "meteringEvent" || kind === "contextUsageEvent") {
                        // Credits/percentages are not token counts or dollar prices. Preserve only bounded scalars.
                        const details = {};
                        for (const key of ["usage", "unit", "contextUsagePercentage"]) {
                            const value = data[key];
                            if (typeof value === "number" && Number.isFinite(value) || typeof value === "string" && value.length <= 64)
                                details[key] = value;
                        }
                        (message.diagnostics ??= []).push({ type: `kiro-${kind}`, timestamp: Date.now(), details });
                    }
                }
                bounded.throwIfAborted();
                flushTags();
                endText();
                endThinking();
                if ([...tools.values()].some(tool => !tool.ended))
                    throw new KiroChatError("Kiro 工具调用流被截断，未执行不完整的工具请求。");
                if (!tools.size && !message.content.some(block => block.type === "text" && !!block.text.trim()))
                    throw new KiroChatError("Kiro 未返回有效文本或工具调用，不能将空回复或未知事件视为成功。");
                if (usageIncomplete)
                    (message.diagnostics ??= []).push({ type: "kiro-usage-incomplete", timestamp: Date.now(), details: { note: "服务用量快照不完整；保留已知计数，缺失项零值不表示精确计量。" } });
                if (!usageSeen)
                    (message.diagnostics ??= []).push({ type: "kiro-usage-unavailable", timestamp: Date.now(), details: { note: "服务未报告精确 token 用量；零值不是实际用量或免费保证。" } });
                message.stopReason = tools.size ? "toolUse" : "stop";
                output.push({ type: "done", reason: message.stopReason, message });
            }
            catch (error) {
                message.stopReason = options.signal?.aborted ? "aborted" : "error";
                message.errorMessage = options.signal?.aborted ? "Kiro 聊天请求已取消。" : bounded.aborted ? "Kiro 聊天请求超时，请重试。" : error instanceof KiroChatError || error instanceof KiroThinkingError ? error.message : "Kiro 聊天网络、响应或请求钩子异常；未回显敏感数据。";
                output.push({ type: "error", reason: message.stopReason, error: message });
            }
            finally {
                if (response)
                    cancelBody(response);
                output.end();
            }
        })();
        return output;
    }
    return { auth, stream };
}
//# sourceMappingURL=kiro-chat.js.map