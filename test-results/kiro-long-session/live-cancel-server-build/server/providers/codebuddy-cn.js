/*!
 * CodeBuddy CN protocol and catalog adapted from https://github.com/decolua/9router
 * commit 87a74e1bda3677193c6f71a7e2100c90311f0689.
 * Applies to this module and codebuddy-auth.ts / codebuddy-models.ts.
 *
 * MIT License
 * Copyright (c) 2024-2026 decolua and contributors
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */
import { createProvider, envApiKeyAuth, lazyApi, } from "@earendil-works/pi-ai";
import { codeBuddyOAuth } from "./codebuddy-auth.js";
import { codeBuddyBaseUrl, codeBuddyHeaders, codeBuddyId, codeBuddyModels } from "./codebuddy-models.js";
const completions = lazyApi(() => import("@earendil-works/pi-ai/api/openai-completions"));
function businessCode(value) {
    if (value && typeof value === "object" && "code" in value && typeof value.code === "number" && value.code !== 0)
        return value.code;
    return undefined;
}
function errorMessage(status, code) {
    if (status === 429 || code === 6004)
        return "CodeBuddy 请求过于频繁或额度不足，请稍后重试并检查账号额度（code 6004 / HTTP 429）。";
    if (status === 401 || status === 403)
        return `CodeBuddy 认证失败（HTTP ${status}），请重新登录。`;
    if (code === 11102)
        return "CodeBuddy 当前账号无法使用此模型（code 11102），请选择其他模型。";
    return `CodeBuddy 请求失败（HTTP ${status}${code === undefined ? "" : `，code ${code}`}）。`;
}
// Normalize HTTP-200 business errors before the OpenAI SDK tries to read SSE.
// Never include raw auth responses or echoed request bodies in user-visible errors.
function chatFetch(transport) {
    return async (input, init) => {
        const response = await transport(input, init);
        if (response.ok && response.headers.get("content-type")?.includes("text/event-stream"))
            return response;
        let code;
        try {
            code = businessCode(await response.json());
        }
        catch { /* HTTP status is still useful. */ }
        const status = code === 6004 ? 429 : response.ok ? 502 : response.status;
        const headers = new Headers({ "content-type": "application/json" });
        const retryAfter = response.headers.get("retry-after");
        if (retryAfter)
            headers.set("retry-after", retryAfter);
        return new Response(JSON.stringify({ error: { message: errorMessage(status, code), type: "codebuddy_error" } }), { status, headers });
    };
}
function streamOptions(options) {
    return {
        ...options,
        fetch: chatFetch(options?.fetch ?? globalThis.fetch),
        async onPayload(payload, model) {
            const transformed = await options?.onPayload?.(payload, model);
            const body = { ...(transformed ?? payload), stream: true };
            if (typeof body.reasoning_effort === "string" && !["none", "off"].includes(body.reasoning_effort)) {
                body.reasoning_summary = "auto";
            }
            else {
                delete body.reasoning_effort;
                delete body.reasoning_summary;
            }
            // Preserve all system messages, tools and tool results. The upstream may
            // reject agent prompts; replacing them silently would discard user constraints.
            return body;
        },
        async onProviderStreamEvent(event, model) {
            await options?.onProviderStreamEvent?.(event, model);
            const code = businessCode(event);
            if (code !== undefined)
                throw new Error(errorMessage(200, code));
        },
    };
}
export function codeBuddyProvider() {
    return createProvider({
        id: codeBuddyId, name: "CodeBuddy 国内版", baseUrl: codeBuddyBaseUrl, headers: codeBuddyHeaders,
        auth: {
            apiKey: envApiKeyAuth("CodeBuddy 国内版访问令牌", ["CODEBUDDY_CN_API_KEY"]),
            oauth: codeBuddyOAuth(),
        },
        models: codeBuddyModels(),
        api: {
            stream: (model, context, options) => completions.stream(model, context, streamOptions(options)),
            streamSimple: (model, context, options) => completions.streamSimple(model, context, streamOptions(options)),
        },
    });
}
//# sourceMappingURL=codebuddy-cn.js.map