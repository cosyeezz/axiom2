import { collapseSystemMessages, getCurrentSystemPrompt, getCurrentTools, type Api, type Model, type TranscriptContext } from "@earendil-works/pi-ai";
import type { KiroCredential } from "./kiro-auth.js";
import { KiroChatError, kiroText, kiroNativeChatRequest, kiroNativeEndpoint } from "./kiro-native-protocol.js";
export { KiroChatError, kiroObject, kiroText, type KiroJson } from "./kiro-native-protocol.js";

export function assertKiroChatModel(model: Model<Api>) {
  if (model.provider !== "kiro" || model.api !== "kiro-chat")
    throw new KiroChatError("Kiro 必须使用原生 kiro-chat 协议；请保留原 modelId、账号和代理，手动改为 kiro-chat 后重新拉取目录。登录不会自动迁移，不支持 OpenAI 或旧认证占位协议。");
  if (model.baseUrl && !["https://q.us-east-1.amazonaws.com", "https://q.eu-central-1.amazonaws.com", "https://q.us-east-1.amazonaws.com/", "https://q.eu-central-1.amazonaws.com/"].includes(model.baseUrl))
    throw new KiroChatError("Kiro 原生推理使用固定 AWS 服务端点，不支持自定义 Base URL；请保留原 modelId、账号和代理，手动清除地址覆盖，代理应通过供应商代理设置配置。不会向该地址发送令牌。");
  if (!kiroText(model.id)) throw new KiroChatError("Kiro 模型 ID 无效。");
}

/** Pi boundary only: resolve transcript system/tool updates before entering the native core. */
export function kiroChatRequest(model: Model<Api>, context: TranscriptContext, account: KiroCredential, sessionId?: string) {
  assertKiroChatModel(model);
  const collapsed = collapseSystemMessages(context);
  return kiroNativeChatRequest(model.id, {
    systemPrompt: getCurrentSystemPrompt(collapsed.messages),
    tools: getCurrentTools(collapsed.messages),
    messages: collapsed.messages.filter(message => message.role !== "system"),
  }, account, sessionId);
}

export const kiroChatEndpoint = kiroNativeEndpoint;
