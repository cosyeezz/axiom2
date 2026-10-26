import { createHash } from "node:crypto";
import { createProvider, envApiKeyAuth, lazyApi } from "@earendil-works/pi-ai";
import { packQoderCredential, QoderCredentials, qoderOAuth } from "./qoder-auth.js";
import { encodeQoderBody, object, qoderChatPath, qoderFailure, qoderHeaders, qoderInference, qoderJson, qoderSignal, qoderSites } from "./qoder-protocol.js";
import { unwrapQoderSse } from "./qoder-sse.js";
import { normalizeQoderConfig, qoderDescriptor } from "./qoder-catalog.js";
import { buildQoderRequest } from "./qoder-client.js";
const completions = lazyApi(() => import("@earendil-works/pi-ai/api/openai-completions"));
export function qoderProvider(region = "intl") {
    const site = qoderSites[region], credentials = new QoderCredentials(region), oauth = qoderOAuth(region);
    const catalogs = new Map();
    async function catalog(identity, transport, signal, force = false) {
        const key = createHash("sha256").update(identity.token).digest("hex"), old = catalogs.get(key);
        if (!force && old && old.expires > Date.now())
            return old;
        const endpoint = await qoderInference(region, identity, transport, signal);
        const url = endpoint + "/algo/api/v2/model/list?Encode=1";
        const data = await qoderJson(transport, url, { signal, headers: { Accept: "application/json", "Accept-Encoding": "identity", ...qoderHeaders("", url, identity) } }, true);
        if (!Array.isArray(data.chat))
            throw Error("Qoder 模型目录格式无效。");
        const configs = new Map();
        for (const item of data.chat) {
            const config = normalizeQoderConfig(item);
            if (config)
                configs.set(config.key, config);
        }
        if (!configs.size)
            throw Error("Qoder 账号没有可用模型，请检查权限。");
        signal?.throwIfAborted();
        if (catalogs.size >= 16)
            catalogs.delete(catalogs.keys().next().value);
        const result = { configs, endpoint, expires: Date.now() + 300000 };
        catalogs.set(key, result);
        return result;
    }
    function options(input, context, model, simple) {
        const transport = input?.fetch ?? globalThis.fetch;
        return {
            ...input, maxRetries: 0, onPayload: undefined,
            // Pi supplies its message/tool encoder and stream parser. Only the signed native URL is fetched.
            fetch: async (_input, init) => {
                const requestedUrl = new URL(_input instanceof Request ? _input.url : String(_input));
                if (requestedUrl.origin !== site.device || requestedUrl.pathname !== "/chat/completions" || requestedUrl.search || requestedUrl.username || requestedUrl.password)
                    throw Error("Qoder 原生接入不支持自定义 Base URL；请选择对应地区，代理请使用其他供应商 ID。");
                const signal = qoderSignal(input?.signal ?? init?.signal, input?.timeoutMs ?? 600000);
                const identity = await credentials.resolve(input?.apiKey, transport, signal);
                let body;
                try {
                    body = object(JSON.parse(String(init?.body)));
                }
                catch {
                    throw Error("Qoder 请求格式无效。");
                }
                const { configs, endpoint } = await catalog(identity, transport, signal), config = configs.get(String(body.model));
                if (!config)
                    throw Error("Qoder 当前账号目录不包含所选模型；请重新拉取模型列表，不会回退到其他模型。");
                const nativeInput = { ...input };
                if (simple) {
                    const simpleInput = input;
                    if (simpleInput?.reasoning)
                        nativeInput.reasoningEffort ??= model.thinkingLevelMap?.[simpleInput.reasoning] ?? simpleInput.reasoning;
                    else if (input && Object.hasOwn(input, "reasoning"))
                        nativeInput.reasoningEffort ??= "none";
                    // Without a Pi thinking selection preserve the official catalog default, not an adapter-generated off.
                    else if (body.reasoning_effort === model.thinkingLevelMap?.off && !Object.hasOwn(input?.samplingParams ?? model.samplingParams ?? {}, "reasoning_effort"))
                        delete body.reasoning_effort;
                    const budget = simpleInput?.reasoning && simpleInput.thinkingBudgets?.[simpleInput.reasoning];
                    if (budget !== undefined)
                        nativeInput.thinkingBudget ??= budget;
                }
                let payload = buildQoderRequest(body, config, region, model, context, nativeInput);
                const replacement = await input?.onPayload?.(payload, model);
                if (replacement !== undefined)
                    payload = replacement;
                const encoded = encodeQoderBody(JSON.stringify(payload));
                if (Buffer.byteLength(encoded) > 6 * 1024 * 1024)
                    throw Error("Qoder 请求超过本地 6 MiB 安全限制，请压缩会话后重试。");
                const url = endpoint + qoderChatPath + "?FetchKeys=llm_model_result&AgentId=agent_common&Encode=1";
                const extraHeaders = {};
                for (const [key, value] of Object.entries({ ...model.headers, ...input?.headers })) {
                    if (typeof value === "string" && !/^(?:authorization|host|cookie|content-length|cosy-.*|x-model-.*|login-version|x-request-id)$/i.test(key))
                        extraHeaders[key] = value;
                }
                let response;
                try {
                    response = await transport(url, {
                        method: "POST", redirect: "error", signal, body: encoded,
                        headers: { ...extraHeaders, "Content-Type": "application/json", Accept: "text/event-stream", "Cache-Control": "no-cache", "Accept-Encoding": "identity",
                            "X-Model-Key": config.key, "X-Model-Source": String(config.source ?? "system"), ...qoderHeaders(encoded, url, identity) },
                    });
                }
                catch {
                    signal.throwIfAborted();
                    throw Error("Qoder 网络请求失败；未自动重放，请确认后重试。");
                }
                if (!response.ok) {
                    void response.body?.cancel().catch(() => { });
                    throw qoderFailure(response.status);
                }
                return unwrapQoderSse(response, signal);
            },
        };
    }
    return createProvider({
        id: site.id, name: site.name, baseUrl: site.device,
        auth: { apiKey: envApiKeyAuth(`${site.name} Personal Access Token（pt-）`, region === "cn" ? ["QODERCN_PERSONAL_ACCESS_TOKEN", "QODER_CN_API_KEY"] : ["QODER_PERSONAL_ACCESS_TOKEN", "QODER_API_KEY"]), oauth },
        models: [],
        async fetchModels(context) {
            const credential = context.credential;
            if (!credential)
                throw Error("Qoder 请先配置认证，再拉取模型目录。");
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
//# sourceMappingURL=qoder.js.map