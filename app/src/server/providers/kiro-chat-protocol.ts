import { createHash, randomUUID } from "node:crypto";
import { collapseSystemMessages, getCurrentSystemPrompt, getCurrentTools, type Api, type Model, type TranscriptContext } from "@earendil-works/pi-ai";
import type { KiroCredential } from "./kiro-auth.js";
import { kiroServiceRegion } from "./kiro-catalog.js";

export class KiroChatError extends Error {}
export type KiroJson = Record<string, unknown>;
export function kiroObject(value: unknown): KiroJson {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new KiroChatError("Kiro 聊天数据格式无效。");
  return value as KiroJson;
}
export function kiroText(value: unknown, limit = 512): value is string {
  return typeof value === "string" && !!value.trim() && value.length <= limit && !/[\x00-\x1f\x7f]/.test(value);
}
export function assertKiroChatModel(model: Model<Api>) {
  if (model.provider !== "kiro" || model.api !== "kiro-chat")
    throw new KiroChatError("Kiro 必须使用原生 kiro-chat 协议；请重新拉取并添加模型，不支持 OpenAI 或旧认证占位协议。");
  if (model.baseUrl && !["https://q.us-east-1.amazonaws.com", "https://q.eu-central-1.amazonaws.com", "https://q.us-east-1.amazonaws.com/", "https://q.eu-central-1.amazonaws.com/"].includes(model.baseUrl))
    throw new KiroChatError("Kiro 原生推理使用固定 AWS 服务端点，不支持自定义 Base URL。");
  if (!kiroText(model.id)) throw new KiroChatError("Kiro 模型 ID 无效。");
}
const alias = (name: string) => /^[a-zA-Z0-9_-]{1,64}$/.test(name) ? name
  : name.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 48) + "_" + createHash("sha256").update(name).digest("hex").slice(0, 12);
type Image = { format: "png" | "jpeg" | "gif" | "webp"; source: { bytes: string } };
type User = { content: string; origin: string; modelId?: string; images?: Image[]; userInputMessageContext?: { tools?: unknown[]; toolResults?: unknown[] } };

const imageFormats = new Map<string, Image["format"]>([["image/png", "png"], ["image/jpeg", "jpeg"], ["image/jpg", "jpeg"], ["image/gif", "gif"], ["image/webp", "webp"]]);
function inputContent(content: string | readonly { type: string; text?: string; data?: string; mimeType?: string }[]) {
  const texts: string[] = [], images: Image[] = [];
  if (typeof content === "string") return { texts: [content], images };
  for (const block of content) {
    if (block.type === "text" && typeof block.text === "string") { texts.push(block.text); continue; }
    if (block.type !== "image") throw new KiroChatError("Kiro 输入包含不支持的内容块；未丢弃内容。");
    const format = typeof block.mimeType === "string" ? imageFormats.get(block.mimeType) : undefined;
    if (!format) throw new KiroChatError("Kiro 图片格式无效；支持 PNG、JPEG、GIF 和 WebP。");
    // AWS blob JSON is base64, not a data URL, path, URL or numeric byte array.
    // Validate before decoding and retain the original bytes: do not re-encode history.
    const data = block.data;
    if (typeof data !== "string" || !data.length || data.length > 10 * 1024 * 1024 ||
        data.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(data) || Buffer.from(data, "base64").toString("base64") !== data)
      throw new KiroChatError("Kiro 图片数据无效或超过本地请求限制；需要完整的 base64 图片字节。");
    images.push({ format, source: { bytes: data } });
  }
  return { texts, images };
}
function appendImages(user: User, images: Image[]) {
  if (images.length) (user.images ??= []).push(...images);
}
type Assistant = { content: string; toolUses?: { toolUseId: string; name: string; input: unknown }[] };
type WireMessage = { userInputMessage: User } | { assistantResponseMessage: Assistant };

/** Original adapter; protocol comparison and defensive-policy decisions: docs/kiro-inference-audit.md. */
export function kiroChatRequest(model: Model<Api>, context: TranscriptContext, account: KiroCredential, sessionId?: string) {
  assertKiroChatModel(model);
  const collapsed = collapseSystemMessages(context), system = getCurrentSystemPrompt(collapsed.messages);
  const names = new Map<string, string>(), usedAliases = new Set<string>();
  const tools = getCurrentTools(collapsed.messages).map(tool => {
    if (!kiroText(tool.name, 256)) throw new KiroChatError("Kiro 工具名称无效。");
    const name = alias(tool.name);
    if (usedAliases.has(name)) throw new KiroChatError("Kiro 工具名称重复或映射冲突。");
    usedAliases.add(name); names.set(name, tool.name);
    if (kiroObject(tool.parameters).type !== "object") throw new KiroChatError("Kiro 工具参数必须使用 object JSON Schema。");
    return { toolSpecification: { name, description: tool.description || tool.name, inputSchema: { json: tool.parameters } } };
  });
  if (tools.length > 1024) throw new KiroChatError("Kiro 工具数量超过本地限制。");
  const wire: WireMessage[] = [], pending = new Map<string, string>(), seenCalls = new Set<string>();
  const historyNotice = { omittedReasoningTextBlocks: 0, opaqueReasoningBlocks: 0, omittedSignatures: 0 };
  const interruptionNotice = { omittedToolCalls: 0 };
  for (const message of collapsed.messages) {
    if (message.role === "system") continue;
    if (message.role === "assistant") {
      // Interrupted/error results are not completed tool requests and must not be replayed.
      if (message.stopReason === "error" || message.stopReason === "aborted") continue;
      if (pending.size) throw new KiroChatError("Kiro 历史中存在未配对的工具调用；请重试或开启新会话。");
      const content = message.content.flatMap(block => {
        if (block.type === "text") return [block.text];
        if (block.type === "toolCall") return [];
        if (block.type !== "thinking") throw new KiroChatError("Kiro 历史包含不支持的助手内容块。");
        if (block.thinkingSignature) historyNotice.omittedSignatures++;
        if (block.redacted) { historyNotice.opaqueReasoningBlocks++; return []; }
        if (!block.thinking) return [];
        historyNotice.omittedReasoningTextBlocks++;
        // Thinking is not ordinary assistant prose. Replaying it as text made the
        // live service imitate our private history wrapper in subsequent answers,
        // especially after changing thinking levels. Keep it in the local transcript
        // only until native reasoning/signature replay has a verified contract.
        // User messages, final answers and tool calls/results remain lossless.
        return [];
      }).join("\n");
      const toolUses = message.content.filter(block => block.type === "toolCall").map(block => {
        if (!kiroText(block.id, 256) || !kiroText(block.name, 256) || seenCalls.has(block.id)) throw new KiroChatError("Kiro 历史工具调用标识无效或重复。");
        kiroObject(block.arguments); seenCalls.add(block.id); pending.set(block.id, block.name);
        return { toolUseId: block.id, name: alias(block.name), input: block.arguments };
      });
      const last = wire.at(-1);
      if (last && "assistantResponseMessage" in last) {
        last.assistantResponseMessage.content += (last.assistantResponseMessage.content && content ? "\n\n" : "") + content;
        if (toolUses.length) last.assistantResponseMessage.toolUses = [...last.assistantResponseMessage.toolUses ?? [], ...toolUses];
      } else if (content || toolUses.length) wire.push({ assistantResponseMessage: { content, ...(toolUses.length ? { toolUses } : {}) } });
    } else if (message.role === "user") {
      if (pending.size) {
        // Cancelling a running tool can leave its completed assistant call in the
        // native transcript without a result. A new user turn closes that flow.
        // Omit only outstanding wire calls, never fabricate a result or edit local
        // history. Paired calls/results and ordinary assistant prose stay intact.
        const index = wire.findLastIndex(item => "assistantResponseMessage" in item), prior = wire[index];
        if (!prior || !("assistantResponseMessage" in prior)) throw new KiroChatError("Kiro 未完成的工具调用缺少助手消息。");
        const assistant = prior.assistantResponseMessage;
        const paired = (assistant.toolUses ?? []).filter(call => !pending.has(call.toolUseId));
        if (paired.length) assistant.toolUses = paired;
        else delete assistant.toolUses;
        if (!assistant.content && !paired.length) wire.splice(index, 1);
        interruptionNotice.omittedToolCalls += pending.size;
        pending.clear(); // Keep seenCalls: an omitted call ID is still historical.
      }
      const { texts, images } = inputContent(message.content), content = texts.join("\n"), last = wire.at(-1);
      if (last && "userInputMessage" in last) {
        last.userInputMessage.content += "\n\n" + content;
        appendImages(last.userInputMessage, images);
      } else {
        const user: User = { content, origin: "KIRO_CLI" };
        appendImages(user, images); wire.push({ userInputMessage: user });
      }
    } else if (message.role === "toolResult") {
      if (pending.get(message.toolCallId) !== message.toolName) throw new KiroChatError("Kiro 工具结果缺少匹配的调用或名称不一致。");
      pending.delete(message.toolCallId);
      const { texts, images } = inputContent(message.content);
      // CLI lifts tool images into userInputMessage.images, alongside toolResults;
      // the result union itself only supports text/json. Keep IDs, status and text blocks.
      const result = { toolUseId: message.toolCallId, status: message.isError ? "error" : "success",
        content: texts.length ? texts.map(text => ({ text })) : [{ text: images.length ? "See images data supplied" : "(empty tool result)" }] };
      const last = wire.at(-1);
      if (last && "userInputMessage" in last) {
        const ctx = last.userInputMessage.userInputMessageContext ??= {};
        (ctx.toolResults ??= []).push(result); appendImages(last.userInputMessage, images);
      } else {
        const user: User = { content: "", origin: "KIRO_CLI", userInputMessageContext: { toolResults: [result] } };
        appendImages(user, images); wire.push({ userInputMessage: user });
      }
    } else throw new KiroChatError("Kiro 历史包含不支持的消息角色。");
  }
  if (pending.size) throw new KiroChatError("Kiro 工具调用尚未收到全部结果。");
  const current = wire.pop();
  if (!current || !("userInputMessage" in current)) throw new KiroChatError("Kiro 聊天请求必须以用户消息或工具结果结束，不支持助手预填充。");
  // The CLI protocol has no system role. Preserve the full prompt in the first user message,
  // without inventing an assistant acknowledgement or replacing Axiom's identity/policies.
  const first = [...wire, current].find(item => "userInputMessage" in item) as { userInputMessage: User };
  if (system) first.userInputMessage.content = `<axiom_system>\n${system}\n</axiom_system>\n\n${first.userInputMessage.content}`;
  current.userInputMessage.modelId = model.id;
  if (tools.length) (current.userInputMessage.userInputMessageContext ??= {}).tools = tools;
  const conversationId = sessionId ? createHash("sha256").update("axiom-kiro-conversation\0" + sessionId).digest("hex").slice(0, 32).replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, "$1-$2-$3-$4-$5") : randomUUID();
  const payload = { conversationState: { conversationId, chatTriggerType: "MANUAL", currentMessage: current, ...(wire.length ? { history: wire } : {}) }, ...(account.profileArn ? { profileArn: account.profileArn } : {}) };
  return { payload, names, seenCalls, historyNotice, interruptionNotice };
}

export function kiroChatEndpoint(account: KiroCredential) { return `https://runtime.${kiroServiceRegion(account)}.kiro.dev/`; }
export function kiroChatFailure(status: number): KiroChatError {
  if (status === 401) return new KiroChatError("Kiro 认证已失效，请重新登录。");
  if (status === 403) return new KiroChatError("Kiro 账号无权使用所选模型，请检查订阅、组织权限及 profile。");
  if (status === 429) return new KiroChatError("Kiro 请求被限流或额度不足（HTTP 429），请稍后重试。");
  return new KiroChatError(`Kiro 聊天请求失败（HTTP ${status}）。`);
}
export function kiroStreamFailure(code: string | undefined): KiroChatError {
  if (code === "ValidationException") return new KiroChatError("Kiro 请求验证失败，请检查消息、所选模型及 profile。");
  if (code === "ThrottlingException" || code === "ServiceQuotaExceededException") return new KiroChatError("Kiro 请求被限流或额度不足（HTTP 429），请稍后重试。");
  if (code === "AccessDeniedException") return kiroChatFailure(403);
  if (code === "InternalServerException") return new KiroChatError("Kiro 服务暂时不可用（HTTP 500），请稍后重试。");
  return new KiroChatError("Kiro 返回了流式服务错误；未回显原始响应。");
}
