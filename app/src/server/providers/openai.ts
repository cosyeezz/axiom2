import { openaiCodexProvider } from "@earendil-works/pi-ai/providers/openai-codex";
import { resolveSamplingParams } from "@earendil-works/pi-ai/api/simple-options";
import type { Api, Model, ModelThinkingLevel, SamplingParams } from "@earendil-works/pi-ai";
import type { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { openAIProviderId } from "../../shared/model-providers.js";
import { recognizeAccountUsageProvider } from "../session-account-observer.js";

/**
 * OpenAI in Axiom deliberately means the native Codex OAuth + Codex Responses
 * connection. Reuse Pi's auth and catalog unchanged: catalog, inference and quota
 * all resolve the same provider ID in the main auth.json and the same proxy.
 * Existing `openai` API-key/direct connections are not converted or overwritten.
 */
export function openAIProvider() {
  const provider = { ...openaiCodexProvider(), name: "OpenAI" };
  recognizeAccountUsageProvider(provider);
  return provider;
}

/** One policy for agents, compression, memory and direct runtime calls. */
export function installOpenAITransport(runtime: ModelRuntime) {
  const stream = runtime.stream.bind(runtime), simple = runtime.streamSimple.bind(runtime);
  // websocket-cached enables both persistent WS and same-session continuation.
  // Pi still owns safe pre-output SSE fallback; this is not a WS-only promise.
  type Options = {
    transport?: string; reasoning?: string; reasoningEffort?: string; samplingParams?: SamplingParams;
    onPayload?: (payload: unknown, model: Model<Api>) => unknown;
  };
  const options = <T,>(model: Model<Api>, input: T | undefined): T | undefined => {
    if (model.api !== "openai-codex-responses") return input;
    const value = input as Options | undefined;
    // Pi's Codex adapter drops samplingParams; merge them like the other
    // OpenAI adapters do, before any observer sees the final payload.
    const level = value?.reasoning ?? value?.reasoningEffort;
    const sampling = resolveSamplingParams(model, (level && level !== "none" ? level : "off") as ModelThinkingLevel, value?.samplingParams);
    const onPayload = sampling && Object.keys(sampling).length ? async (payload: unknown, target: Model<Api>) => {
      const merged = payload && typeof payload === "object" ? { ...payload, ...sampling } : payload;
      const replacement = await value?.onPayload?.(merged, target);
      return replacement === undefined ? merged : replacement;
    } : value?.onPayload;
    return { ...value, onPayload, ...(model.provider === openAIProviderId ? { transport: "websocket-cached" } : {}) } as T;
  };
  runtime.stream = (model, context, value) => stream(model, context, options(model, value));
  runtime.streamSimple = (model, context, value) => simple(model, context, options(model, value));
}
