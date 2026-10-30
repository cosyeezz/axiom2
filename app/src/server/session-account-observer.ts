import { AsyncLocalStorage } from "node:async_hooks";
import type { ModelRuntime, ModelRuntimeAuthOverrides } from "@earendil-works/pi-coding-agent";
import type { AnyModel, AuthResult, Model, Api, Provider, ProviderHeaders } from "@earendil-works/pi-ai";
import { getApiProvider } from "@earendil-works/pi-ai/compat";
import type { Selection } from "../shared/agent.js";
import { modelCredentialRevision, readModelCredential } from "./model-account-storage.js";
import { openAIAccountId } from "./providers/openai-account-info.js";

const native = new WeakMap<Provider, Pick<Provider, "stream" | "streamSimple" | "getModels">>();
const openAIApis = new Map(["openai-responses", "openai-completions", "openai-codex-responses"].map(api => {
  const provider = getApiProvider(api);
  return [api, { stream: provider?.stream, streamSimple: provider?.streamSimple }] as const;
}));
/** Only the application's unchanged native Codex factory calls this, never extension registration. */
export function recognizeAccountUsageProvider(provider: Provider) {
  native.set(provider, { stream: provider.stream, streamSimple: provider.streamSimple, getModels: provider.getModels });
}
export type AccountRequestContext = { selection: Selection; sessionId: string; originalStream: boolean; requestId: string; modelRevision: number };
type Observation = AccountRequestContext & { model?: Model<Api>; authStarted?: boolean; auth?: AuthResult; headers?: ProviderHeaders; prepared?: boolean };
export type AccountRequestProof = { selection: Selection; provider: string; api: string; credentialKey: string; requestId: string; modelRevision: number };

/** Observe existing SDK auth and prepared headers. Never resolve or refresh auth an extra time. */
export function createSessionAccountObserver(runtime: ModelRuntime, authPath: string, emit: (proof: AccountRequestProof) => void) {
  const flow = new AsyncLocalStorage<Observation>(), originalAuth = runtime.getAuth, getAuth = originalAuth.bind(runtime);
  const originalSimple = runtime.streamSimple, simple = originalSimple.bind(runtime);
  let active = true, latestRequestId: string | undefined;
  const observedAuth = (async (target: AnyModel | string, options?: ModelRuntimeAuthOverrides) => {
    const observation = flow.getStore(), model = observation?.model;
    // Model copies clone the physical model but retain provider/API/endpoint.
    // Claim only the SDK's first auth call; nested header hooks cannot replace it.
    const claimed = !!observation && !observation.authStarted && typeof target !== "string" && !!model &&
      target.provider === model.provider && target.api === model.api && target.baseUrl === model.baseUrl;
    if (claimed) observation.authStarted = true;
    const resolved = typeof target === "string" ? await getAuth(target, options) : await getAuth(target, options);
    if (claimed) observation.auth = resolved;
    return resolved;
  }) as typeof runtime.getAuth;
  const trustedTransport = (model: Model<Api>) => {
    if (runtime.getRegisteredProviderConfig(model.provider)) return false;
    const provider = runtime.getRegisteredNativeProvider(model.provider), api = getApiProvider(model.api), initial = openAIApis.get(model.api);
    // Composition may fall back to the global API when a catalog lacks the API.
    // Both possible native dispatch routes must remain the known implementation.
    if (!initial?.streamSimple || api?.streamSimple !== initial.streamSimple || api?.stream !== initial.stream) return false;
    if (model.provider === "openai-codex") {
      const known = provider && native.get(provider);
      return !!known && provider!.stream === known.stream && provider!.streamSimple === known.streamSimple && provider!.getModels === known.getModels && model.api === "openai-codex-responses";
    }
    return model.provider === "openai" && !provider && ["openai-responses", "openai-completions"].includes(model.api);
  };
  const observedSimple: typeof runtime.streamSimple = (model, context, options) => {
    const entry = flow.getStore();
    if (!entry || entry.sessionId !== options?.sessionId || model.api === "pi-virtual") return simple(model, context, options);
    const observation: Observation = { ...entry, model, authStarted: false, auth: undefined, headers: undefined, prepared: false };
    const next = { ...options,
      transformHeaders: async (headers: ProviderHeaders) => {
        const final = options?.transformHeaders ? await options.transformHeaders(headers) : headers;
        observation.headers = final; observation.prepared = true;
        return final;
      },
      onPayload: async (payload: unknown, actual: typeof model) => {
        const replacement = await options?.onPayload?.(payload, actual);
        try {
          const resolved = observation.auth, credential = readModelCredential(model.provider, authPath);
          const endpoint = resolved?.auth.baseUrl ?? model.baseUrl;
          const expected = model.provider === "openai-codex" ? "https://chatgpt.com/backend-api" : "https://api.openai.com/v1";
          const safeHeaders = (headers?: ProviderHeaders) => Object.entries(headers ?? {}).every(([key, value]) => {
            if (value === null) return true;
            switch (key.toLowerCase()) {
              case "authorization": return credential?.type === "oauth" && value === `Bearer ${credential.access}`;
              case "chatgpt-account-id": return credential?.type === "oauth" && value === openAIAccountId(credential.accountId);
              // Known non-identity headers only; arbitrary extension/account routing is not proven.
              case "accept": case "content-type": case "user-agent": case "originator": case "openai-beta": case "oai-language": return true;
              default: return false;
            }
          });
          if (active && latestRequestId === entry.requestId && !options?.signal?.aborted && entry.originalStream && observation.prepared && actual.provider === model.provider && actual.api === model.api && entry.selection.provider === model.provider &&
              trustedTransport(model) && endpoint.replace(/\/$/, "") === expected && actual.baseUrl.replace(/\/$/, "") === expected &&
              credential?.type === "oauth" && credential.access === resolved?.auth.apiKey && (!options?.apiKey || options.apiKey === credential.access) &&
              !Object.keys(resolved.env ?? {}).length && safeHeaders(model.headers) && safeHeaders(observation.headers)) {
            emit({ selection: entry.selection, provider: model.provider, api: model.api, credentialKey: modelCredentialRevision(credential)!, requestId: entry.requestId, modelRevision: entry.modelRevision });
          }
        } catch { /* Observation never changes transport, auth resolution, payload or inference outcome. */ }
        return replacement;
      },
    };
    return flow.run(observation, () => simple(model, context, next));
  };
  runtime.getAuth = observedAuth; runtime.streamSimple = observedSimple;
  return {
    observe<T>(request: AccountRequestContext, perform: () => T): T {
      latestRequestId = request.requestId;
      return flow.run(request, perform);
    },
    restore() {
      active = false;
      if (runtime.getAuth === observedAuth) runtime.getAuth = originalAuth;
      if (runtime.streamSimple === observedSimple) runtime.streamSimple = originalSimple;
      flow.disable();
    },
  };
}
