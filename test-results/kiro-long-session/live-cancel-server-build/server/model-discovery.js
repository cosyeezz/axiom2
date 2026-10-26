import { AppError } from "../shared/protocol.js";
import { modelApis } from "../shared/models.js";
function fail(message) { throw new AppError("MODEL_DISCOVERY_FAILED", message); }
const record = (value) => value !== null && typeof value === "object" && !Array.isArray(value) ? value : undefined;
/** Only the configured endpoint supplies identities. Never follow a redirect with credentials. */
export async function discoverModels(options) {
    if (!modelApis.includes(options.api))
        fail("此协议暂不支持模型列表发现，请手动添加模型。");
    let url;
    try {
        url = new URL(options.baseUrl);
    }
    catch {
        return fail("接口地址无效，请检查连接配置。");
    }
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.hash)
        fail("模型列表接口仅支持不含用户名、密码或片段的 HTTP/HTTPS 地址。");
    const google = options.api === "google-generative-ai";
    const anthropic = options.api === "anthropic-messages";
    let path = url.pathname.replace(/\/+$/, "");
    if (anthropic && !path.endsWith("/v1"))
        path += "/v1";
    if (google && !path)
        path = "/v1beta";
    url.pathname = `${path}/models`;
    const headers = new Headers({ accept: "application/json" });
    if (anthropic)
        headers.set("anthropic-version", "2023-06-01");
    const key = options.auth?.apiKey;
    if (key)
        headers.set(google ? "x-goog-api-key" : anthropic ? "x-api-key" : "authorization", google || anthropic ? key : `Bearer ${key}`);
    if (key && options.authHeader)
        headers.set("authorization", `Bearer ${key}`);
    // Explicit headers resolved by pi override all generated authentication headers.
    for (const [name, value] of Object.entries(options.auth?.headers ?? {})) {
        if (value === null)
            headers.delete(name);
        else
            headers.set(name, value);
    }
    const models = new Map();
    const cursors = new Set();
    let bytes = 0;
    for (let page = 0; page < 20; page++) {
        const response = await fetch(url, { headers, signal: options.signal, redirect: "manual" });
        if (!response.ok) {
            await response.body?.cancel();
            if (response.status === 401 || response.status === 403)
                fail(`模型列表请求被拒绝（HTTP ${response.status}），请检查密钥、请求头和账号权限。`);
            if (response.status === 404 || response.status === 405)
                fail(`接口不支持当前模型列表地址（HTTP ${response.status}），请检查 Base URL 或手动添加模型。`);
            if (response.status >= 300 && response.status < 400)
                fail("模型列表接口返回重定向；请直接填写最终 Base URL 后重试。");
            fail(`模型列表请求失败（HTTP ${response.status}），请稍后重试。`);
        }
        if (!response.body)
            fail("模型列表接口返回空响应。");
        const reader = response.body.getReader();
        const chunks = [];
        try {
            while (true) {
                const { done, value } = await reader.read();
                if (done)
                    break;
                bytes += value.byteLength;
                if (bytes > 2_000_000)
                    fail("模型列表响应超过 2 MB，请缩小接口返回范围。");
                chunks.push(value);
            }
        }
        finally {
            await reader.cancel();
            reader.releaseLock();
        }
        let body;
        try {
            body = record(JSON.parse(Buffer.concat(chunks).toString("utf8")));
        }
        catch {
            return fail("模型列表接口未返回有效 JSON。");
        }
        const items = body?.[google ? "models" : "data"];
        if (!Array.isArray(items))
            fail("模型列表响应格式不受支持，请检查接口协议。");
        for (const value of items) {
            const item = record(value);
            if (google && Array.isArray(item?.supportedGenerationMethods) &&
                !item.supportedGenerationMethods.includes("generateContent"))
                continue;
            const rawId = google ? item?.name : item?.id;
            const id = typeof rawId === "string" ? (google ? rawId.replace(/^models\//, "") : rawId) : "";
            if (!id || id.length > 160 || /[\x00-\x20\x7f]/.test(id) || ["__proto__", "prototype", "constructor"].includes(id))
                fail("模型列表包含无效或过长的模型 ID。");
            const label = google ? item?.displayName : item?.display_name ?? item?.name;
            const name = typeof label === "string" && label.trim() && label.length <= 160 && !/[\x00-\x1f\x7f]/.test(label) ? label.trim() : id;
            models.set(id, { id, name });
            if (models.size > 1000)
                fail("模型列表超过 1,000 项，请缩小接口返回范围。");
        }
        const more = google ? !!body?.nextPageToken : body?.has_more === true;
        if (!more)
            return [...models.values()].sort((a, b) => a.name.localeCompare(b.name));
        const cursor = google ? body?.nextPageToken : body?.last_id;
        if (typeof cursor !== "string" || !cursor || cursor.length > 4096 || cursors.has(cursor))
            fail("模型列表分页标识无效，未返回不完整列表。");
        cursors.add(cursor);
        url.searchParams.set(google ? "pageToken" : "after_id", cursor);
    }
    return fail("模型列表分页过多，未返回不完整列表。");
}
//# sourceMappingURL=model-discovery.js.map