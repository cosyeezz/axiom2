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
import {
  createProvider, envApiKeyAuth, lazyApi,
  type StreamOptions,
} from "@earendil-works/pi-ai";
import { codeBuddyOAuth } from "./codebuddy-auth.js";
import { codeBuddyBaseUrl, codeBuddyHeaders, codeBuddyId, codeBuddyModels } from "./codebuddy-models.js";
import { codeBuddyFetch } from "./codebuddy-response.js";

const completions = lazyApi(() => import("@earendil-works/pi-ai/api/openai-completions"));

function streamOptions<T extends StreamOptions>(options?: T): T & StreamOptions {
  return {
    ...options,
    fetch: codeBuddyFetch(options?.fetch ?? globalThis.fetch),
    async onPayload(payload, model) {
      const transformed = await options?.onPayload?.(payload, model);
      const body: Record<string, unknown> = { ...((transformed ?? payload) as Record<string, unknown>), stream: true };
      if (typeof body.reasoning_effort === "string" && !["none", "off"].includes(body.reasoning_effort)) {
        body.reasoning_summary = "auto";
      } else {
        // Pi maps UI off to "none". Omitting that signal is not equivalent:
        // a live GLM off request still returned thinking. Keep the explicit
        // disable value, without summary; never hide received thinking instead.
        if (body.reasoning_effort === "none" || body.reasoning_effort === "off") body.reasoning_effort = "none";
        else delete body.reasoning_effort;
        delete body.reasoning_summary;
      }
      // Preserve all system messages, tools and tool results. The upstream may
      // reject agent prompts; replacing them silently would discard user constraints.
      return body;
    },
  } as T & StreamOptions;
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
