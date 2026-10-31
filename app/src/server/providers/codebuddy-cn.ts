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
import { envApiKeyAuth, type Credential, type Provider } from "@earendil-works/pi-ai";
import { codeBuddyOAuth } from "./codebuddy-auth.js";
import { codeBuddyBaseUrl, codeBuddyHeaders, codeBuddyId, codeBuddyModels } from "./codebuddy-models.js";
import { codeBuddyChat } from "./codebuddy-chat.js";
import { createCodeBuddyCatalog } from "../../native-providers/codebuddy/catalog.js";
import { CodeBuddyProtocolError } from "../../native-providers/codebuddy/failure.js";
import { validCodeBuddyToken } from "../../native-providers/codebuddy/json.js";

export type CodeBuddyProvider = Provider<"openai-completions"> & { dispose(): void; catalogState(): { source: "builtin" | "network"; refresh: "idle" | "pending" | "succeeded" | "failed"; permissionsVerified: false } };
export function codeBuddyProvider(options: { fetch?: typeof fetch } = {}): CodeBuddyProvider {
  const chat = codeBuddyChat({ apiKey: envApiKeyAuth("CodeBuddy 国内版访问令牌", ["CODEBUDDY_CN_API_KEY"]), oauth: codeBuddyOAuth(options) }, options.fetch);
  const catalog = createCodeBuddyCatalog(options.fetch);
  let models = codeBuddyModels(), scope: string | undefined;
  let ambient = false, scopeType: Credential["type"] | undefined;
  let source: "builtin" | "network" = "builtin", refresh: "idle" | "pending" | "succeeded" | "failed" = "idle";
  const credentialAccess = (credential: Credential | undefined) => credential?.type === "oauth" ? credential.access : credential?.key;
  const reset = () => { catalog.invalidate(); chat.invalidate(); scope = undefined; scopeType = undefined; ambient = false; models = codeBuddyModels(); source = "builtin"; refresh = "idle"; };
  return {
    id: codeBuddyId, name: "CodeBuddy 国内版", baseUrl: codeBuddyBaseUrl, headers: codeBuddyHeaders, auth: chat.auth,
    getModels: () => structuredClone(models),
    catalogState: () => ({ source, refresh, permissionsVerified: false }),
    filterModels(items, credential) {
      // Synchronous availability after logout/account switch must not expose the previous account's cloud list.
      const access = credentialAccess(credential);
      const builtinIds = new Set(codeBuddyModels().map(model => model.id));
      // Pi availability supplies the STORED credential, not the resolved env/config key.
      // Offline refresh/reconfiguration invalidates this ambient snapshot before another key is selected.
      if (!access && ambient && scopeType === "api_key" && (!credential || credential.type === "api_key")) return items;
      return scope !== undefined && access !== scope ? items.filter(model => builtinIds.has(model.id)) : items;
    },
    async refreshModels(context) {
      context.signal.throwIfAborted();
      if (context.baseUrl !== undefined && ![codeBuddyBaseUrl, `${codeBuddyBaseUrl}/`].includes(context.baseUrl)) throw new CodeBuddyProtocolError("target");
      let access = credentialAccess(context.credential);
      // Pi resolves API-key credentials through auth.resolve for the network phase.
      // Redeem that RAM handoff here, never send the opaque ticket as a bearer.
      if (context.allowNetwork) access = chat.consumeAccess(access);
      if (!validCodeBuddyToken(access)) {
        await context.publish({ update: () => { reset(); ambient = !context.credential || context.credential.type === "api_key" && !context.credential.key; } });
        return;
      }
      const current = access;
      if (!await context.publish({ update: () => {
        if (scope !== undefined && scope !== current) chat.invalidate();
        const snapshot = catalog.get(current); scope = current; scopeType = context.credential?.type;
        if (!context.allowNetwork) ambient = false;
        models = codeBuddyModels(snapshot.models); source = snapshot.source;
        refresh = context.allowNetwork ? "pending" : "idle";
      } })) return;
      if (!context.allowNetwork) return;
      try {
        const snapshot = await catalog.refresh(current, context.signal);
        context.signal.throwIfAborted();
        await context.publish({ update: () => { scope = current; models = codeBuddyModels(snapshot.models); source = snapshot.source; refresh = "succeeded"; } });
      } catch (error) {
        await context.publish({ update: () => { refresh = "failed"; } });
        throw error;
      }
    },
    stream: (model, context, input) => chat.stream(model, context, input), streamSimple: chat.stream,
    dispose() { reset(); catalog.dispose(); chat.dispose(); },
  };
}
