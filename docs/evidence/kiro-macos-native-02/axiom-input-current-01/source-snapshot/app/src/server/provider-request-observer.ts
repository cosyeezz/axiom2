import { randomUUID } from "node:crypto";
import type { StreamFn } from "@earendil-works/pi-agent-core";
import type { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { createAssistantMessageEventStream, type Provider } from "@earendil-works/pi-ai";
import { getApiProvider } from "@earendil-works/pi-ai/compat";
import type { ProviderRequestEvent } from "../shared/provider-requests.js";
import { workerInstance } from "./execution-protocol.js";

// Do not inject fetch into unsupported adapters, native SDKs or arbitrary extensions.
const httpApis = ["openai-responses", "openai-completions", "azure-openai-responses", "anthropic-messages", "openai-codex-responses", "mistral-conversations", "pi-messages"];
const initialApis = new Map(httpApis.map(api => {
  const provider = getApiProvider(api);
  return [api, { stream: provider?.stream, streamSimple: provider?.streamSimple }] as const;
}));
const nativeResult = createAssistantMessageEventStream().result;
const nativeHttp = new WeakMap<Provider, Pick<Provider, "stream" | "streamSimple">>();

/** Called only for the application's known built-in factories, not extensions. */
export function recognizeProviderRequestTransport(provider: Provider) {
  nativeHttp.set(provider, { stream: provider.stream, streamSimple: provider.streamSimple });
}

export function providerRequestHttpTransport(runtime: Pick<ModelRuntime, "getRegisteredProviderConfig" | "getRegisteredNativeProvider">,
  model: Parameters<StreamFn>[0], options: Parameters<StreamFn>[2]) {
  if (runtime.getRegisteredProviderConfig(model.provider)?.streamSimple) return false;
  const native = runtime.getRegisteredNativeProvider(model.provider);
  if (native) {
    const known = nativeHttp.get(native);
    if (!known || known.stream !== native.stream || known.streamSimple !== native.streamSimple) return false;
    if (model.api === "kiro-chat" && model.provider === "kiro") return true;
    if (model.provider !== "codebuddy-cn") return false;
  }
  if (!httpApis.includes(model.api) || model.api === "openai-codex-responses" && options?.transport !== "sse") return false;
  const initial = initialApis.get(model.api), current = getApiProvider(model.api);
  return !!initial?.streamSimple && initial.streamSimple === current?.streamSimple && initial.stream === current?.stream;
}

/** Observe completion promises, never consume/replay stream events or response bodies. */
export function observeProviderRequests<F extends StreamFn>(base: F, emit: (event: ProviderRequestEvent) => void,
  httpTransport: (model: Parameters<StreamFn>[0], options: Parameters<StreamFn>[2]) => boolean): F {
  const observed: StreamFn = (model, context, options) => {
    // Pi routes this into runtime.streamSimple again with the physical model.
    if (model.api === "pi-virtual") return base(model, context, options);
    const publish = (event: ProviderRequestEvent) => { try { emit(event); } catch { /* Statistics cannot affect inference. */ } };
    const active = new Set<string>();
    let finished = false;
    const start = (provider: string, precision: "http" | "call") => {
      const id = randomUUID();
      // A cancelled stream or unsupported completion may settle before a slow
      // hook/fetch resumes. Observe nothing late, but do not block the real call.
      if (finished) return id;
      active.add(id);
      publish({ type: "provider_request_stat", phase: "start", id, provider, precision });
      return id;
    };
    const end = (id: string) => { if (active.delete(id)) publish({ type: "provider_request_stat", phase: "end", id }); };
    const finish = () => { finished = true; for (const id of active) end(id); };
    const physicalHttp = httpTransport(model, options);
    let callStarted = false, payloadReady = false;
    const next = { ...options, onPayload: async (payload: unknown, target: typeof model) => {
      const replacement = await options?.onPayload?.(payload, target);
      payloadReady = true;
      // After payload hooks/auth preparation; local validation failures before here do not count.
      if (!physicalHttp && !callStarted) { callStarted = true; start(target.provider, "call"); }
      return replacement;
    } };
    if (physicalHttp) {
      const fetcher = options?.fetch ?? globalThis.fetch;
      next.fetch = async (...args: Parameters<typeof fetch>) => {
        // Kiro enterprise profile discovery also uses options.fetch, before onPayload.
        // Auth/catalog preparation is not inference and must keep the original transport.
        if (!payloadReady) return fetcher(...args);
        const id = start(model.provider, "http");
        try {
          const response = await fetcher(...args);
          // An upstream rejection is no longer doing inference. End before SDK backoff;
          // successful streaming responses stay active until the model stream settles.
          if (!response.ok) end(id);
          return response;
        } catch (error) { end(id); throw error; }
      };
    }
    const observe = (stream: Awaited<ReturnType<StreamFn>>) => {
      try {
        // Runtime returns Pi's native lazy stream even for custom providers. Never
        // invoke an arbitrary result override just to collect statistics.
        if (stream.result !== nativeResult) { finish(); return; }
        void stream.result().then(finish, finish).catch(() => {});
      } catch { finish(); }
    };
    try {
      const stream = base(model, context, next);
      if (stream instanceof Promise) void stream.then(observe, finish).catch(() => {});
      else observe(stream);
      return stream;
    } catch (error) { finish(); throw error; }
  };
  // The wrapper returns exactly what base returns (including sync vs async and
  // generic API/options signatures); StreamFn is only the common observation shape.
  return observed as F;
}

export function installProviderRequestObserver(runtime: ModelRuntime) {
  if (!workerInstance) return;
  const emit = (event: ProviderRequestEvent) => {
    if (process.connected) {
      try { process.send?.({ ...event, instance: workerInstance }, () => {}); } catch { /* IPC shutdown is not an inference error. */ }
    }
  };
  const httpTransport = (model: Parameters<StreamFn>[0], options: Parameters<StreamFn>[2]) =>
    providerRequestHttpTransport(runtime, model, options);
  runtime.stream = observeProviderRequests(runtime.stream.bind(runtime), emit, httpTransport);
  runtime.streamSimple = observeProviderRequests(runtime.streamSimple.bind(runtime), emit, httpTransport);
}
