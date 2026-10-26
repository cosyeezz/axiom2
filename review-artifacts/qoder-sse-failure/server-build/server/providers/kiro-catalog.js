import { createHash, randomUUID } from "node:crypto";
import { kiroThinkingModel } from "./kiro-thinking.js";
const maxBytes = 2 * 1024 * 1024;
const maxModels = 1000;
const regions = new Set(["us-east-1", "eu-central-1"]);
function object(value) {
    if (!value || typeof value !== "object" || Array.isArray(value))
        throw Error("Kiro 模型目录响应格式无效。");
    return value;
}
function text(value, limit) {
    return typeof value === "string" && !!value.trim() && value.length <= limit && !/[\x00-\x1f\x7f]/.test(value);
}
export function validateKiroCredential(credential) {
    if (credential?.type !== "oauth" || !text(credential.access, 32768) || !text(credential.refresh, 32768) ||
        !["builder-id", "identity-center", "social"].includes(String(credential.authMethod)) ||
        !text(credential.authRegion, 64) || !/^[a-z]{2}(?:-[a-z]+)+-\d$/.test(credential.authRegion) || credential.authRegion.startsWith("cn-") ||
        typeof credential.expires !== "number" || !Number.isSafeInteger(credential.expires))
        throw Error("Kiro 目录凭据无效，请重新登录。");
    if (credential.authMethod === "social" && credential.authRegion !== "us-east-1")
        throw Error("Kiro 个人社交登录的认证区域无效，请重新登录。");
    if (credential.profileArn !== undefined && (!text(credential.profileArn, 2048) ||
        !/^arn:aws:(?:codewhisperer|qdeveloper):(?:us-east-1|eu-central-1):\d{12}:profile\/[A-Za-z0-9._/-]+$/.test(credential.profileArn)))
        throw Error("Kiro profile ARN 无效或区域不受支持，请重新选择账号配置。");
    return credential;
}
export function kiroServiceRegion(credential) {
    // CLI selects the service region from the chosen profile, not the SSO login region.
    const region = credential.profileArn?.split(":")[3];
    return region && regions.has(region) ? region : "us-east-1";
}
export function kiroCatalogScope(credential) {
    try {
        const value = validateKiroCredential(credential);
        return createHash("sha256").update(JSON.stringify(["kiro-catalog-v1", value.authMethod, value.authRegion,
            value.refresh, value.profileArn ?? null, kiroServiceRegion(value)])).digest("hex");
    }
    catch {
        return undefined;
    }
}
function limit(value) {
    if (value === undefined || value === null || value === 0)
        return 0; // Unknown, including nullable SDK fields.
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0 || value > 100_000_000)
        throw Error("Kiro 模型 token 上限格式无效。");
    return value;
}
/** Missing/unknown declarations are not an upstream denial of vision support. */
export function kiroCatalogInput(model) {
    const declared = model.kiroSupportedInputTypes;
    return declared?.some(value => value === "TEXT" || value === "IMAGE") ? [...model.input] : undefined;
}
function descriptor(value, baseUrl) {
    const item = object(value);
    if (!text(item.modelId, 512) || item.modelName != null && !text(item.modelName, 1024))
        throw Error("Kiro 模型标识或名称无效。");
    const limits = item.tokenLimits == null ? {} : object(item.tokenLimits);
    const inputTypes = item.supportedInputTypes;
    if (inputTypes != null && (!Array.isArray(inputTypes) || !inputTypes.every(value => text(value, 128))))
        throw Error("Kiro 模型输入能力格式无效。");
    return {
        id: item.modelId, name: typeof item.modelName === "string" ? item.modelName : item.modelId,
        provider: "kiro", api: "kiro-chat", baseUrl,
        // IMAGE is an upstream declaration, not a guess from the model name. Missing
        // declarations remain unknown; text is the baseline, not evidence of no vision.
        input: inputTypes?.includes("IMAGE") ? ["text", "image"] : ["text"], ...kiroThinkingModel(item.modelId),
        ...(inputTypes != null ? { kiroSupportedInputTypes: [...inputTypes] } : {}),
        contextWindow: limit(limits.maxInputTokens), maxTokens: limit(limits.maxOutputTokens),
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    };
}
export function restoreKiroCatalog(models, legacy = false) {
    try {
        if (!Array.isArray(models) || models.length > maxModels)
            return undefined;
        const seen = new Set();
        return models.map((value) => {
            const item = object(value);
            if (item.provider !== "kiro" || !["kiro-chat", "kiro-auth-only"].includes(String(item.api)) ||
                !["https://q.us-east-1.amazonaws.com", "https://q.eu-central-1.amazonaws.com"].includes(String(item.baseUrl)) ||
                !text(item.id, 512) || !text(item.name, 1024) || seen.has(item.id) ||
                !Array.isArray(item.input) || !item.input.includes("text") || new Set(item.input).size !== item.input.length ||
                !item.input.every(value => value === "text" || value === "image"))
                throw Error();
            seen.add(item.id);
            // V1 wrote text-only adapter metadata, not upstream capability declarations.
            const model = descriptor({ modelId: item.id, modelName: item.name, supportedInputTypes: legacy ? undefined : item.kiroSupportedInputTypes,
                tokenLimits: { maxInputTokens: item.contextWindow || undefined, maxOutputTokens: item.maxTokens || undefined } }, String(item.baseUrl));
            if (item.contextWindow !== model.contextWindow || item.maxTokens !== model.maxTokens ||
                JSON.stringify(item.input) !== JSON.stringify(model.input))
                throw Error();
            return model;
        });
    }
    catch {
        return undefined;
    }
}
async function responseJson(response, signal) {
    if (Number(response.headers.get("content-length")) > maxBytes) {
        await response.body?.cancel();
        throw Error("Kiro 模型目录响应超过本地 2 MiB 限制。");
    }
    const reader = response.body?.getReader();
    if (!reader)
        throw Error("Kiro 模型目录响应为空。");
    const chunks = [];
    let size = 0;
    const abort = () => { void reader.cancel().catch(() => { }); };
    signal.addEventListener("abort", abort, { once: true });
    try {
        signal.throwIfAborted();
        for (;;) {
            const { done, value } = await reader.read();
            signal.throwIfAborted();
            if (done)
                break;
            size += value.byteLength;
            if (size > maxBytes)
                throw Error("Kiro 模型目录响应超过本地 2 MiB 限制。");
            chunks.push(value);
        }
        try {
            return object(JSON.parse(Buffer.concat(chunks).toString("utf8")));
        }
        catch {
            throw Error("Kiro 模型目录响应格式无效。");
        }
    }
    finally {
        signal.removeEventListener("abort", abort);
        await reader.cancel().catch(() => { });
        reader.releaseLock();
    }
}
export async function fetchKiroCatalog(credential, signal, transport = globalThis.fetch) {
    const account = validateKiroCredential(credential);
    if (account.expires <= Date.now())
        throw Error("Kiro 访问令牌已过期，请刷新认证后重试。");
    const bounded = AbortSignal.any([signal, AbortSignal.timeout(15_000)]);
    const baseUrl = `https://q.${kiroServiceRegion(account)}.amazonaws.com`;
    const models = new Map(), tokens = new Set();
    let nextToken;
    // Match the CLI AWS JSON operation, including its query/body double serialization.
    // No IDE origin, shared/placeholder profile, arbitrary endpoint, or static model IDs.
    for (let page = 0; page < 20; page++) {
        bounded.throwIfAborted();
        const body = { origin: "KIRO_CLI", ...(account.profileArn ? { profileArn: account.profileArn } : {}),
            ...(nextToken ? { nextToken } : {}) };
        const url = new URL(baseUrl + "/");
        for (const [key, value] of Object.entries(body))
            url.searchParams.set(key, value);
        let response;
        try {
            response = await transport(url.href, {
                method: "POST", redirect: "error", signal: bounded,
                headers: { Authorization: `Bearer ${account.access}`, "Content-Type": "application/x-amz-json-1.0",
                    Accept: "application/json", "x-amz-target": "AmazonCodeWhispererService.ListAvailableModels",
                    "amz-sdk-invocation-id": randomUUID(), "amz-sdk-request": "attempt=1; max=1",
                    "User-Agent": "Axiom KiroCatalog/1.0" },
                body: JSON.stringify(body),
            });
        }
        catch {
            bounded.throwIfAborted();
            throw Error("Kiro 模型目录网络请求失败，请检查网络后重试。");
        }
        if (bounded.aborted) {
            await response.body?.cancel();
            bounded.throwIfAborted();
        }
        if (!response.ok) {
            await response.body?.cancel();
            if (response.status === 401)
                throw Error("Kiro 认证已失效，请重新登录后拉取模型目录。");
            if (response.status === 403)
                throw Error("Kiro 账号无权读取模型目录，请检查订阅、组织权限及所选 profile。");
            if (response.status === 429)
                throw Error("Kiro 模型目录请求被限流，请稍后重试。");
            throw Error(`Kiro 模型目录请求失败（HTTP ${response.status}）。`);
        }
        const result = await responseJson(response, bounded);
        if (!Array.isArray(result.models) || result.models.length > maxModels)
            throw Error("Kiro 模型目录缺少有效的 models 数组。");
        // The CLI SDK requires defaultModel on every page. It is not an extra catalog identity.
        descriptor(result.defaultModel, baseUrl);
        for (const item of result.models) {
            const model = descriptor(item, baseUrl);
            if (!models.has(model.id))
                models.set(model.id, model);
            if (models.size > maxModels)
                throw Error("Kiro 模型目录超过本地 1000 项限制。");
        }
        bounded.throwIfAborted();
        if (result.nextToken === undefined || result.nextToken === null || result.nextToken === "")
            return [...models.values()];
        if (!text(result.nextToken, 8192) || tokens.has(result.nextToken))
            throw Error("Kiro 模型目录分页标记无效或重复。");
        nextToken = result.nextToken;
        tokens.add(nextToken);
    }
    throw Error("Kiro 模型目录超过本地 20 页限制；未发布不完整目录。");
}
//# sourceMappingURL=kiro-catalog.js.map