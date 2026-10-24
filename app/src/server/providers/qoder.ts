import { createHash, randomUUID } from "node:crypto";
import { createProvider, envApiKeyAuth, lazyApi, type Context, type Model, type StreamOptions } from "@earendil-works/pi-ai";
import { packQoderCredential, QoderCredentials, qoderOAuth } from "./qoder-auth.js";
import { encodeQoderBody, object, qoderChatPath, qoderFailure, qoderHeaders, qoderInference, qoderJson, qoderSignal, qoderSites, type QoderIdentity, type QoderRegion } from "./qoder-protocol.js";
import { unwrapQoderSse } from "./qoder-sse.js";

const completions = lazyApi(() => import("@earendil-works/pi-ai/api/openai-completions"));
const positive = (value: unknown, fallback: number) => typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : fallback;
// Text-only metadata; account catalog/config is required before inference.
function descriptor(region: QoderRegion, config: Record<string, unknown>): Model<"openai-completions"> {
  return {
    id: String(config.key), name: typeof config.display_name === "string" ? config.display_name : String(config.key),
    provider: qoderSites[region].id, api: "openai-completions", baseUrl: qoderSites[region].device,
    reasoning: false, input: ["text"], contextWindow: positive(config.max_input_tokens, 32768), maxTokens: positive(config.max_output_tokens, 8192),
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    compat: { supportsStore: false, supportsDeveloperRole: false, supportsReasoningEffort: false, supportsUsageInStreaming: true, maxTokensField: "max_tokens", supportsStrictMode: false },
  };
}

function requestBody(body: Record<string, unknown>, config: Record<string, unknown>, region: QoderRegion, sessionId?: string) {
  if (!Array.isArray(body.messages)) throw Error("Qoder 请求缺少消息。");
  const systems: string[] = [], messages: Record<string, unknown>[] = [];
  for (const item of body.messages) {
    const message = { ...object(item) };
    if (Array.isArray(message.content)) {
      message.content = message.content.map(part => {
        const block = object(part);
        if (block.type !== "text" || typeof block.text !== "string") throw Error("Qoder 当前接入仅支持文本；图片和文件内容不会被静默丢弃。");
        return block.text;
      }).join("\n");
    }
    if (message.role === "system" || message.role === "developer") {
      if (typeof message.content !== "string") throw Error("Qoder 系统提示格式无效。");
      systems.push(message.content);
    } else messages.push(message);
  }
  const lastUser = messages.findLast(message => message.role === "user")?.content;
  const text = typeof lastUser === "string" ? lastUser : "";
  const record = randomUUID(), requestedMax = positive(body.max_tokens ?? body.max_completion_tokens, 8192);
  // Never select a larger/billable context tier implicitly or rewrite the agent identity/policies.
  return {
    request_id: randomUUID(), request_set_id: record, chat_record_id: record, session_id: sessionId ?? randomUUID(),
    stream: true, chat_task: "FREE_INPUT", is_reply: true, is_retry: false, source: 1, version: "3",
    session_type: region === "cn" ? "qoderclicn" : "qodercli", agent_id: "agent_common", task_id: "common", code_language: "", chat_prompt: "", image_urls: null, aliyun_user_type: "",
    system: systems.join("\n\n"), messages, tools: body.tools ?? [], parameters: { max_tokens: Math.min(requestedMax, positive(config.max_output_tokens, 8192)) },
    chat_context: { chatPrompt: "", imageUrls: null, extra: { context: [], modelConfig: { key: config.key, is_reasoning: !!config.is_reasoning }, originalContent: text }, features: [], text },
    // Official CLI w_l projects only inference fields; do not forward BYOK keys/URLs or arbitrary catalog metadata.
    model_config: { key: config.key, display_name: typeof config.display_name === "string" ? config.display_name : config.key,
      model: "", format: typeof config.format === "string" ? config.format : "openai", is_vl: !!config.is_vl,
      is_reasoning: !!config.is_reasoning, api_key: "", url: "", source: "system", max_input_tokens: positive(config.max_input_tokens, 32768) },
    business: { product: "cli", version: "1.0.0", type: "agent", stage: "start", id: randomUUID(), name: text.slice(0, 30), begin_at: Date.now() },
  };
}

export function qoderProvider(region: QoderRegion = "intl") {
  const site = qoderSites[region], credentials = new QoderCredentials(region), oauth = qoderOAuth(region);
  const catalogs = new Map<string, { expires: number; configs: Map<string, Record<string, unknown>>; endpoint: string }>();
  async function catalog(identity: QoderIdentity, transport: typeof fetch, signal?: AbortSignal, force = false) {
    const key = createHash("sha256").update(identity.token).digest("hex"), old = catalogs.get(key);
    if (!force && old && old.expires > Date.now()) return old;
    const endpoint = await qoderInference(region, identity, transport, signal);
    const url = endpoint + "/algo/api/v2/model/list?Encode=1";
    const data = await qoderJson(transport, url, { signal, headers: { Accept: "application/json", "Accept-Encoding": "identity", ...qoderHeaders("", url, identity) } }, true);
    if (!Array.isArray(data.chat)) throw Error("Qoder 模型目录格式无效。");
    const configs = new Map<string, Record<string, unknown>>();
    for (const item of data.chat) {
      const config = object(item);
      if (typeof config.key !== "string" || !config.key || config.enable === false || config.outer_provider || config.source && config.source !== "system" || config.custom_provider_adapter) continue;
      configs.set(config.key, { ...config });
    }
    if (!configs.size) throw Error("Qoder 账号没有可用模型，请检查权限。");
    signal?.throwIfAborted();
    if (catalogs.size >= 16) catalogs.delete(catalogs.keys().next().value!);
    const result = { configs, endpoint, expires: Date.now() + 300000 };
    catalogs.set(key, result);
    return result;
  }
  function options<T extends StreamOptions>(input: T | undefined, context: Context): T & StreamOptions {
    const transport = input?.fetch ?? globalThis.fetch;
    return {
      ...input, maxRetries: 0,
      // The OpenAI adapter constructs messages/tools only. The fake OpenAI URL is never fetched.
      fetch: async (_input, init) => {
        // Check the original context: the OpenAI adapter filters unsupported images before fetch.
        if (context.messages.some(message => Array.isArray(message.content) && message.content.some(block => !["text", "thinking", "toolCall"].includes(block.type))))
          throw Error("Qoder 当前接入仅支持文本；图片和文件内容不会被静默丢弃。");
        const requestedUrl = new URL(_input instanceof Request ? _input.url : String(_input));
        if (requestedUrl.origin !== site.device || requestedUrl.pathname !== "/chat/completions" || requestedUrl.search || requestedUrl.username || requestedUrl.password)
          throw Error("Qoder 原生接入不支持自定义 Base URL；请选择对应地区，代理请使用其他供应商 ID。");
        const signal = qoderSignal(input?.signal ?? init?.signal, 600000);
        const identity = await credentials.resolve(input?.apiKey, transport, signal);
        let body: Record<string, unknown>;
        try { body = object(JSON.parse(String(init?.body))); } catch { throw Error("Qoder 请求格式无效。"); }
        const { configs, endpoint } = await catalog(identity, transport, signal), config = configs.get(String(body.model));
        if (!config) throw Error("Qoder 当前账号目录不包含所选模型；请重新拉取模型列表，不会回退到其他模型。");
        const payload = requestBody(body, config, region, input?.sessionId);
        const encoded = encodeQoderBody(JSON.stringify(payload));
        if (Buffer.byteLength(encoded) > 6 * 1024 * 1024) throw Error("Qoder 请求超过本地 6 MiB 安全限制，请压缩会话后重试。");
        const url = endpoint + qoderChatPath + "?FetchKeys=llm_model_result&AgentId=agent_common&Encode=1";
        let response: Response;
        try {
          response = await transport(url, {
            method: "POST", redirect: "error", signal, body: encoded,
            headers: { "Content-Type": "application/json", Accept: "text/event-stream", "Cache-Control": "no-cache", "Accept-Encoding": "identity",
              "X-Model-Key": String(config.key), "X-Model-Source": typeof config.source === "string" ? config.source : "system", ...qoderHeaders(encoded, url, identity) },
          });
        } catch { signal.throwIfAborted(); throw Error("Qoder 网络请求失败；未自动重放，请确认后重试。"); }
        if (!response.ok) { await response.body?.cancel(); throw qoderFailure(response.status); }
        return unwrapQoderSse(response, signal);
      },
    } as T & StreamOptions;
  }
  return createProvider<"openai-completions">({
    id: site.id, name: site.name, baseUrl: site.device,
    auth: { apiKey: envApiKeyAuth(`${site.name} Personal Access Token（pt-）`, region === "cn" ? ["QODER_CN_API_KEY"] : ["QODER_PERSONAL_ACCESS_TOKEN", "QODER_API_KEY"]), oauth },
    models: [],
    async fetchModels(context) {
      const credential = context.credential;
      if (!credential) throw Error("Qoder 请先配置认证，再拉取模型目录。");
      const key = credential.type === "oauth" ? packQoderCredential(credential, region) : credential.key;
      const identity = await credentials.resolve(key, globalThis.fetch, context.signal);
      const { configs } = await catalog(identity, globalThis.fetch, context.signal, context.force);
      return [...configs.values()].map(config => descriptor(region, config));
    },
    api: {
      stream: (model, context, input) => completions.stream(model, context, options(input, context)),
      streamSimple: (model, context, input) => completions.streamSimple(model, context, options(input, context)),
    },
  });
}
