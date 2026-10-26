import { kiroOAuth } from "./kiro-auth.js";
import { fetchKiroCatalog, kiroCatalogScope, restoreKiroCatalog } from "./kiro-catalog.js";
import { kiroChat } from "./kiro-chat.js";
/** Native account catalog and AWS event-stream chat adapter. */
export function kiroProvider(options = {}) {
    let models = [];
    let scope;
    let generation = 0;
    const chat = kiroChat(kiroOAuth(options), options.fetch);
    return {
        id: "kiro", name: "kiro", auth: { oauth: chat.auth },
        getModels: () => models,
        catalogState: () => ({ generation, scope }),
        // Availability may be read without refresh after logout or an account switch.
        filterModels: (items, credential) => {
            const current = kiroCatalogScope(credential);
            return current && current === scope ? items : [];
        },
        async refreshModels(context) {
            const current = kiroCatalogScope(context.credential);
            const stored = context.stored;
            const restored = current && stored && [1, 2].includes(stored.cacheVersion) && stored.cacheScope === current
                ? restoreKiroCatalog(stored.models, stored.cacheVersion === 1) : undefined;
            // Check on BOTH phases: OAuth refresh may rotate the token between them.
            // Missing, legacy, or invalid storage also invalidates a warm same-scope catalog.
            if (!await context.publish({ update: () => { models = restored ?? []; scope = current; } }))
                return;
            if (!context.allowNetwork || !context.credential)
                return;
            const fetched = await fetchKiroCatalog(context.credential, context.signal, options.fetch);
            const entry = { models: fetched, checkedAt: Date.now(), cacheVersion: 2, cacheScope: current };
            await context.publish({ persist: entry, update: () => { models = fetched; scope = current; generation++; } });
        },
        stream: (model, context, input) => chat.stream(model, context, input),
        streamSimple: chat.stream,
    };
}
//# sourceMappingURL=kiro.js.map