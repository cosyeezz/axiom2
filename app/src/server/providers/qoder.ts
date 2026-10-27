import { createHash } from "node:crypto";
import { createProvider, envApiKeyAuth, lazyApi, type Api, type Model, type SimpleStreamOptions, type StreamOptions, type TranscriptContext } from "@earendil-works/pi-ai";
import { imagesInput } from "../images.js";
import { packQoderCredential, QoderCredentials, qoderOAuth } from "./qoder-auth.js";
import { assertQoderBodyBudget, assertQoderBodySize, encodeQoderBody, object, qoderChatPath, QoderError, qoderFailure, qoderHeaders, qoderInference, qoderJson, qoderSignal, qoderSites, type QoderIdentity, type QoderRegion } from "./qoder-protocol.js";
import { unwrapQoderSse } from "./qoder-sse.js";
import { normalizeQoderConfig, qoderDescriptor, type QoderConfig } from "./qoder-catalog.js";
import { buildQoderRequest, qoderClientOptions, type QoderStreamOptions } from "./qoder-client.js";

const completions = lazyApi(() => import("@earendil-works/pi-ai/api/openai-completions"));
function validateImages(context: TranscriptContext) {
  // Bound the entire replay before decoding; native mixed messages duplicate each base64 string.
  let imageCharacters = 0;
  for (const message of context.messages) {
    if (!Array.isArray(message.content)) continue;
    for (const block of message.content) {
      if (block.type === "image" && typeof block.data === "string") {
        imageCharacters += block.data.length;
        assertQoderBodySize(imageCharacters * 2);
      }
    }
  }
  let hasImages = false;
  for (const message of context.messages) {
    if (!Array.isArray(message.content)) continue;
    if (message.content.some(block => !["text", "thinking", "toolCall", "image"].includes(block.type)))
      throw new QoderError("Qoder 不支持此消息内容；文件或其他非文本内容不会被静默丢弃。");
    const images = message.content.filter(block => block.type === "image");
    imagesInput(images.map((image, index) => ({ ...image, id: `img${index + 1}`, name: `image-${index + 1}` })));
    hasImages ||= images.length > 0;
  }
  return hasImages;
}
// SDK fetch exceptions hide actionable local errors; expose only controlled diagnostics as API errors.
const requestError = (message: string, status = 400) => new Response(JSON.stringify({ error: { message } }), { status, headers: { "content-type": "application/json" } });
export function qoderProvider(region: QoderRegion = "intl") {
  const site = qoderSites[region], credentials = new QoderCredentials(region), oauth = qoderOAuth(region);
  const catalogs = new Map<string, { expires: number; configs: Map<string, QoderConfig>; endpoint: string }>();
  async function catalog(identity: QoderIdentity, transport: typeof fetch, signal?: AbortSignal, force = false) {
    const key = createHash("sha256").update(identity.token).digest("hex"), old = catalogs.get(key);
    if (!force && old && old.expires > Date.now()) return old;
    const endpoint = await qoderInference(region, identity, transport, signal);
    const url = endpoint + "/algo/api/v2/model/list?Encode=1";
    const data = await qoderJson(transport, url, { signal, headers: { Accept: "application/json", "Accept-Encoding": "identity", ...qoderHeaders("", url, identity) } }, true);
    if (!Array.isArray(data.chat)) throw new QoderError("Qoder 模型目录格式无效。");
    const configs = new Map<string, QoderConfig>();
    for (const item of data.chat) {
      const config = normalizeQoderConfig(item);
      if (config) configs.set(config.key, config);
    }
    if (!configs.size) throw new QoderError("Qoder 账号没有可用模型，请检查权限。");
    signal?.throwIfAborted();
    if (catalogs.size >= 16) catalogs.delete(catalogs.keys().next().value!);
    const result = { configs, endpoint, expires: Date.now() + 300000 };
    catalogs.set(key, result);
    return result;
  }
  function options(input: StreamOptions | undefined, context: TranscriptContext, model: Model<Api>, simple: boolean): StreamOptions {
    const transport = input?.fetch ?? globalThis.fetch;
    const hasImages = context.messages.some(message => Array.isArray(message.content) && message.content.some(block => block.type === "image"));
    return {
      ...input, maxRetries: 0,
      onPayload(payload) {
        validateImages(context);
        assertQoderBodyBudget(payload);
        const override = qoderClientOptions(input, object(payload)).customModelOverride;
        if (hasImages && !model.input.includes("image") && override?.isVl !== true)
          throw new QoderError("Qoder 所选模型未声明图片能力；请重新拉取目录并明确选择支持图片的模型，不会自动换模型或丢弃图片。");
        // The caller hook runs once on the final native payload, not on this SDK intermediate.
      },
      fetch: async (_input, init) => {
        const signal = qoderSignal(input?.signal ?? init?.signal, input?.timeoutMs ?? 600000);
        try {
          const requestedUrl = new URL(_input instanceof Request ? _input.url : String(_input));
          if (requestedUrl.origin !== site.device || requestedUrl.pathname !== "/chat/completions" || requestedUrl.search || requestedUrl.username || requestedUrl.password)
            return requestError("Qoder 原生接入不支持自定义 Base URL；请选择对应地区，代理请使用其他供应商 ID。");
          const identity = await credentials.resolve(input?.apiKey, transport, signal);
          let body: Record<string, unknown>;
          try { body = object(JSON.parse(String(init?.body))); } catch { return requestError("Qoder 请求格式无效。"); }
          const { configs, endpoint } = await catalog(identity, transport, signal), config = configs.get(String(body.model));
          if (!config) return requestError("Qoder 当前账号目录不包含所选模型；请重新拉取模型列表，不会回退到其他模型。");
          const nativeInput: QoderStreamOptions = { ...input };
          if (simple) {
            const simpleInput = input as SimpleStreamOptions | undefined;
            if (simpleInput?.reasoning) nativeInput.reasoningEffort ??= model.thinkingLevelMap?.[simpleInput.reasoning] ?? simpleInput.reasoning;
            else if (input && Object.hasOwn(input, "reasoning")) nativeInput.reasoningEffort ??= "none";
            // Without a Pi thinking selection preserve the official catalog default.
            else if (body.reasoning_effort === model.thinkingLevelMap?.off && !Object.hasOwn(input?.samplingParams ?? model.samplingParams ?? {}, "reasoning_effort")) delete body.reasoning_effort;
            const budget = simpleInput?.reasoning && simpleInput.thinkingBudgets?.[simpleInput.reasoning as keyof NonNullable<SimpleStreamOptions["thinkingBudgets"]>];
            if (budget !== undefined) nativeInput.thinkingBudget ??= budget;
          }
          let payload: unknown = buildQoderRequest(body, config, region, model, context, nativeInput);
          assertQoderBodyBudget(payload);
          const replacement = await input?.onPayload?.(payload, model);
          if (replacement !== undefined) payload = replacement;
          assertQoderBodyBudget(payload);
          const encoded = encodeQoderBody(JSON.stringify(payload));
          const url = endpoint + qoderChatPath + "?FetchKeys=llm_model_result&AgentId=agent_common&Encode=1";
          const extraHeaders: Record<string, string> = {};
          for (const [key, value] of Object.entries({ ...model.headers, ...input?.headers })) {
            if (typeof value === "string" && !/^(?:authorization|host|cookie|content-length|cosy-.*|x-model-.*|login-version|x-request-id)$/i.test(key)) extraHeaders[key] = value;
          }
          let response: Response;
          try {
            response = await transport(url, {
              method: "POST", redirect: "error", signal, body: encoded,
              headers: { ...extraHeaders, "Content-Type": "application/json", Accept: "text/event-stream", "Cache-Control": "no-cache", "Accept-Encoding": "identity",
                "X-Model-Key": config.key, "X-Model-Source": String(config.source ?? "system"), ...qoderHeaders(encoded, url, identity) },
            });
          } catch { signal.throwIfAborted(); throw new QoderError("Qoder 网络请求失败；未自动重放，请确认后重试。"); }
          if (!response.ok) {
            void response.body?.cancel().catch(() => {}); signal.throwIfAborted();
            return requestError(qoderFailure(response.status).message, response.status);
          }
          return unwrapQoderSse(response, signal);
        } catch (error) {
          input?.signal?.throwIfAborted(); init?.signal?.throwIfAborted();
          if (signal.aborted) return requestError("Qoder 请求超时；未自动重放，请确认后重试。", 504);
          return requestError(error instanceof QoderError ? error.message : "Qoder 请求处理失败；未自动重放，请确认后重试。", 502);
        }
      },
    };
  }
  return createProvider<"openai-completions">({
    id: site.id, name: site.name, baseUrl: site.device,
    auth: { apiKey: envApiKeyAuth(`${site.name} Personal Access Token（pt-）`, region === "cn" ? ["QODERCN_PERSONAL_ACCESS_TOKEN", "QODER_CN_API_KEY"] : ["QODER_PERSONAL_ACCESS_TOKEN", "QODER_API_KEY"]), oauth },
    models: [],
    async fetchModels(context) {
      const credential = context.credential;
      if (!credential) throw new QoderError("Qoder 请先配置认证，再拉取模型目录。");
      const key = credential.type === "oauth" ? packQoderCredential(credential, region) : credential.key;
      const identity = await credentials.resolve(key, globalThis.fetch, context.signal);
      const { configs } = await catalog(identity, globalThis.fetch, context.signal, context.force);
      return [...configs.values()].map(config => qoderDescriptor(region, config));
    },
    api: {
      stream: (model, context, input) => completions.stream(model, context, options(input, context, model, false)),
      streamSimple: (model, context, input) => completions.streamSimple(model, context, options(input, context, model, true)),
    },
  });
}
