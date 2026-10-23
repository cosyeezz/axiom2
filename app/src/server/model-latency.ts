import type { StreamFn } from "@earendil-works/pi-agent-core";
import { createAssistantMessageEventStream, type AssistantMessageEventStream } from "@earendil-works/pi-ai";
import { getApiProvider } from "@earendil-works/pi-ai/compat";
import type { DeliveryTiming, LatencyRecord } from "../shared/latency.js";

// This module loads before worker extensions. Keep function identities, since
// compat also allows replacing standard APIs outside the runtime provider registry.
const fetchApis = ["openai-responses", "openai-completions", "azure-openai-responses", "anthropic-messages"];
const initialApis = new Map(fetchApis.map(api => [api, getApiProvider(api)?.streamSimple]));
const nativeResult = createAssistantMessageEventStream().result;

/** Allowlisted classifications; never forward provider error text to diagnostics. */
export function latencyError(value: unknown): string {
  const text = typeof value === "string" ? value : value instanceof Error ? value.message : "";
  if (/overload/i.test(text)) return "overloaded";
  if (/rate.?limit|\b429\b/i.test(text)) return "rate_limit";
  if (/server_error|\b50[0234]\b/i.test(text)) return "server_error";
  if (/abort|cancel/i.test(text)) return "cancelled";
  if (/timeout|timed out/i.test(text)) return "timeout";
  return "other";
}

/** One run owns this observer; callbacks retain their request even after a retry. */
export class ModelLatency {
  private sequence = 0;
  private update = 0;
  private current?: { id: string; started: number; first: Set<string>; purpose: "session" | "auxiliary" };
  constructor(private runId: string, private emit: (record: LatencyRecord) => void) {}
  private record(stage: string, request = this.current, extra: Partial<LatencyRecord> = {}) {
    try { this.emit({ stage, at: Date.now(), runId: this.runId, requestId: request?.id, purpose: request?.purpose, ...extra }); }
    catch { /* Observation must not fail inference. */ }
  }
  wrap(base: StreamFn, settings: { sessionId?: string; defaultFetch?: (model: Parameters<StreamFn>[0]) => boolean } = {}): StreamFn {
    return (model, context, options) => {
      const purpose: "session" | "auxiliary" = settings.sessionId && options?.sessionId !== settings.sessionId ? "auxiliary" : "session";
      const request = { id: `${this.runId}:${++this.sequence}`, started: performance.now(), first: new Set<string>(), purpose };
      if (purpose === "session") this.current = request;
      this.record("model.request", request);
      let attempt = 0;
      const next = { ...options,
        onPayload: async (payload: unknown, payloadModel: typeof model) => {
          this.record("model.payload", request);
          return options?.onPayload?.(payload, payloadModel);
        },
        onResponse: async (response: { status: number; headers: Record<string, string> }, responseModel: typeof model) => {
          this.record("model.response", request, { status: response.status, durationMs: performance.now() - request.started });
          await options?.onResponse?.(response, responseModel);
        },
        onProviderStreamEvent: async (data: unknown, eventModel: typeof model) => {
          if (!request.first.has("event")) {
            request.first.add("event");
            this.record("model.first_event", request, { durationMs: performance.now() - request.started });
          }
          await options?.onProviderStreamEvent?.(data, eventModel);
        },
      };
      // Never supply a default transport to an arbitrary custom stream. The worker
      // opts in only for the original SDK stream without native/extension overrides.
      if (fetchApis.includes(model.api) && (options?.fetch || settings.defaultFetch?.(model) &&
          initialApis.get(model.api) && initialApis.get(model.api) === getApiProvider(model.api)?.streamSimple)) {
        const fetcher = options?.fetch ?? globalThis.fetch;
        next.fetch = async (...args: Parameters<typeof fetch>) => {
          const number = ++attempt, started = performance.now();
          this.record("http.start", request, { attempt: number });
          try {
            const response = await fetcher(...args);
            this.record("http.headers", request, { attempt: number, status: response.status, durationMs: performance.now() - started });
            return response; // Never clone, buffer, or consume the body.
          } catch (error) {
            this.record("http.error", request, { attempt: number, code: latencyError(error), durationMs: performance.now() - started });
            throw error;
          }
        };
      }
      let ended = false;
      const finish = (error?: unknown) => {
        if (ended) return;
        ended = true;
        this.record("model.end", request, { durationMs: performance.now() - request.started, code: error ? latencyError(error) : "ok" });
      };
      const observe = (stream: AssistantMessageEventStream) => {
        // result() is an independent completion promise: it does not consume the
        // iterator, including for summaries that never emit agent message_end.
        try {
          if (stream.result !== nativeResult) {
            this.record("model.unobserved_end", request, { code: "custom_result" });
            return;
          }
          void stream.result().then(message => finish(message.errorMessage ||
            (message.stopReason === "aborted" ? "cancelled" : message.stopReason === "error" ? "unknown" : undefined)), finish).catch(() => {});
        } catch { /* Custom diagnostic-incompatible streams remain untouched. */ }
      };
      try {
        const stream = base(model, context, next);
        if (stream instanceof Promise) void stream.then(observe, finish);
        else observe(stream);
        return stream;
      } catch (error) { finish(error); throw error; }
    };
  }
  first(kind: "text" | "thinking" | "toolcall") {
    if (!this.current || this.current.first.has(kind)) return;
    this.current.first.add(kind);
    this.record(`model.first_${kind}`, this.current, { durationMs: performance.now() - this.current.started });
  }
  retry(stage: "start" | "end", attempt: number, delayMs?: number, code?: string) {
    this.record(`retry.${stage}`, this.current, { attempt, durationMs: delayMs, code });
  }
  delivery(): DeliveryTiming | undefined {
    if (!this.current) return;
    return { runId: this.runId, requestId: this.current.id, updateId: ++this.update, workerAt: Date.now() };
  }
}
