import { readFileSync } from "node:fs";
import type { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { createAssistantMessageEventStream, type AssistantMessageEventStream, type AnyModel, type AssistantMessage, type Model, type Api, type Context } from "@earendil-works/pi-ai";

/** Keep local configuration identities out of upstream model requests. */
export function installModelCopies(runtime: ModelRuntime, path: string | null | undefined) {
  let targets = new Map<string, string>();
  const reload = () => {
    const next = new Map<string, string>();
    if (path) {
      try {
        const config = JSON.parse(readFileSync(path, "utf8"));
        for (const [provider, value] of Object.entries(config.providers ?? {})) {
          for (const model of (value as { models?: { id: string; axiomRequestModelId?: string }[] }).models ?? []) {
            if (typeof model.axiomRequestModelId === "string" && model.axiomRequestModelId)
              next.set(`${provider}\0${model.id}`, model.axiomRequestModelId);
          }
        }
      } catch {
        // ModelRuntime reports malformed configuration; never keep a stale mapping.
      }
    }
    targets = next;
  };
  reload();
  const refresh = runtime.refresh.bind(runtime);
  runtime.refresh = async options => {
    const result = await refresh(options);
    reload();
    return result;
  };
  const identities = new WeakMap<AnyModel, AnyModel>();
  const requestModel = <T extends Model<Api>>(model: T): T => {
    const id = targets.get(`${model.provider}\0${model.id}`);
    if (!id) return model;
    const request = { ...model, id };
    identities.set(request, model);
    return request;
  };
  // Authentication must still resolve the copy's own saved headers, including edits/deletions.
  const getAuth = runtime.getAuth.bind(runtime);
  runtime.getAuth = ((model: string | AnyModel, options?: Parameters<typeof getAuth>[1]) =>
    typeof model === "string" ? getAuth(model, options) : getAuth(identities.get(model) ?? model, options)
  ) as typeof runtime.getAuth;

  const localStream = (source: AssistantMessageEventStream, model: Model<Api>) => {
    const output = createAssistantMessageEventStream();
    const local = (message: AssistantMessage) => ({ ...message, model: model.id });
    void (async () => {
      try {
        for await (const event of source) {
          if (event.type === "done") output.push({ ...event, message: local(event.message) });
          else if (event.type === "error") output.push({ ...event, error: local(event.error) });
          else output.push({ ...event, partial: local(event.partial) });
        }
        output.end(local(await source.result()));
      } catch (error) {
        output.push({ type: "error", reason: "error", error: {
          role: "assistant", content: [], api: model.api, provider: model.provider, model: model.id,
          usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
          stopReason: "error", errorMessage: error instanceof Error ? error.message : String(error), timestamp: Date.now(),
        } });
      }
    })();
    return output;
  };
  const requestContext = (context: Context): Context => ({
    ...context,
    messages: context.messages.map(message => {
      if (message.role !== "assistant") return message;
      const id = targets.get(`${message.provider}\0${message.model}`);
      return id ? { ...message, model: id } : message;
    }),
  });
  const stream = runtime.stream.bind(runtime);
  runtime.stream = (model, context, options) => {
    const request = requestModel(model), result = stream(request, requestContext(context), options);
    return request === model ? result : localStream(result, model);
  };
  const simple = runtime.streamSimple.bind(runtime);
  runtime.streamSimple = (model, context, options) => {
    const request = requestModel(model), result = simple(request, requestContext(context), options);
    return request === model ? result : localStream(result, model);
  };
  const deferred = runtime.streamDeferred.bind(runtime);
  runtime.streamDeferred = (model, handle, options) => {
    const request = requestModel(model), result = deferred(request, handle, options);
    return request === model ? result : localStream(result, model);
  };
  const cancel = runtime.cancelDeferred.bind(runtime);
  runtime.cancelDeferred = (model, handle, options) => cancel(requestModel(model), handle, options);
}
