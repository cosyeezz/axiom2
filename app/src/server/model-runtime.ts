import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { getAgentDir, ModelRuntime, readStoredCredential } from "@earendil-works/pi-coding-agent";
import { installModelCopies } from "./model-copies.js";
import { catalogMetadata, credentialMetadata } from "./model-metadata.js";
import type { ModelConfiguration } from "../shared/models.js";

type Template = ModelConfiguration["templates"][number];
const nativeProviders = [{
  template: { id: "codebuddy-cn", name: "CodeBuddy 国内版", api: "openai-completions", url: "https://copilot.tencent.com/v2", methods: ["api_key", "oauth"] } satisfies Template,
  load: async () => (await import("./providers/codebuddy-cn.js")).codeBuddyProvider(),
}, {
  template: { id: "kiro", name: "kiro", api: "kiro-chat", url: "", methods: ["oauth"] } satisfies Template,
  load: async () => (await import("./providers/kiro.js")).kiroProvider(),
}, {
  template: { id: "qoder", name: "Qoder", api: "openai-completions", url: "https://api2.qoder.sh", methods: ["api_key", "oauth"] } satisfies Template,
  load: async () => (await import("./providers/qoder.js")).qoderProvider("intl"),
}, {
  template: { id: "qoder-cn", name: "Qoder 国内版", api: "openai-completions", url: "https://gateway.qoder.com.cn", methods: ["api_key", "oauth"] } satisfies Template,
  load: async () => (await import("./providers/qoder.js")).qoderProvider("cn"),
}];

// The add-provider menu is metadata. Listing it must not initialize a provider.
export function nativeProviderTemplates(): Template[] {
  return nativeProviders.map(({ template }) => ({ ...template, methods: [...template.methods] }));
}

export async function ensureModelProvider(runtime: ModelRuntime, providerId: string) {
  await registerModelProvider(runtime, providerId);
}

async function registerModelProvider(runtime: ModelRuntime, providerId: string) {
  const definition = nativeProviders.find(item => item.template.id === providerId);
  if (!definition || runtime.getRegisteredNativeProvider(providerId)) return;
  const provider = await definition.load();
  if (runtime.getRegisteredNativeProvider(providerId)) return;
  // pi registers synchronously but starts an unawaited refresh afterwards. Keep
  // registration from mutating a worker's captured model files in the background.
  const refresh = runtime.refresh;
  runtime.refresh = async () => ({ aborted: false, errors: new Map() });
  if (providerId === "kiro") {
    // Pi uses getAllModels for composition, but getModels for native API routing.
    // Keep the real catalog (including an empty one) separate from the composed
    // chat models, so valid explicit models never fall through to a global API.
    // No capability-only/fake model is published and scope filtering is unchanged.
    const catalog = provider.getModels.bind(provider);
    provider.getAllModels = catalog;
    provider.getModels = () => {
      const composed = runtime.getProvider(providerId);
      // Without models.json overrides Pi returns this native instance itself.
      // Calling its wrapped getter again would recurse during login/refresh.
      return composed && composed !== provider ? composed.getModels() : catalog();
    };
  }
  try { runtime.registerNativeProvider(provider); }
  finally { runtime.refresh = refresh; }
  if (providerId === "kiro") {
    const { assertKiroChatModel } = await import("./providers/kiro-chat-protocol.js");
    const getAuth = runtime.getAuth.bind(runtime);
    // Pi composes models.json API overrides above native providers. Reject such
    // overrides before generic transport dispatch, not just inside native stream().
    runtime.getAuth = (async (target: Parameters<typeof getAuth>[0] | string, options?: Parameters<typeof getAuth>[1]) => {
      if (typeof target !== "string" && target.provider === "kiro") assertKiroChatModel(target as Parameters<typeof assertKiroChatModel>[0]);
      return typeof target === "string" ? getAuth(target, options) : getAuth(target, options);
    }) as typeof runtime.getAuth;
    const stream = runtime.stream.bind(runtime), streamSimple = runtime.streamSimple.bind(runtime);
    // Pi pre-resolves summary auth once, then reuses those options for split
    // summaries/retries. A handoff is not a reusable credential: discard it here
    // and let the SDK resolve current OAuth auth for EACH physical request.
    // Arbitrary API keys still reach the native rejection path, never the wire.
    const requestOptions = <T extends { apiKey?: string }>(model: { provider: string }, options: T | undefined): T | undefined =>
      model.provider === "kiro" && options?.apiKey?.startsWith("axiom-kiro-native:")
        ? { ...options, apiKey: undefined } : options;
    runtime.stream = (model, context, options) => stream(model, context, requestOptions(model, options));
    runtime.streamSimple = (model, context, options) => streamSimple(model, context, requestOptions(model, options));
  }
}

type RuntimeOptions = Parameters<typeof ModelRuntime.create>[0] & {
  /** IDs from the application's validated configuration or an explicit user action. */
  providerIds?: readonly string[];
  /** Local display only: no auth checks, credential locks, cache writes or runtime refresh. */
  metadataOnly?: boolean;
  /** Execution restores only its selected provider, never unrelated account catalogs. */
  providerScope?: string;
  /** Credential-blind definition validation: no auth or catalog/cache restoration. */
  configurationOnly?: boolean;
};

export async function createModelRuntime(options: RuntimeOptions = {}) {
  const { providerIds = [], metadataOnly = false, providerScope, configurationOnly = false, ...sdkOptions } = options;
  const credentials = options.credentials ?? (configurationOnly ? {
    read: async () => undefined, list: async () => [],
    modify: async () => { throw Error("Definition validation is read-only"); },
    delete: async () => { throw Error("Definition validation is read-only"); },
  } : metadataOnly ? credentialMetadata(options.authPath ?? join(getAgentDir(), "auth.json"), providerScope) : undefined);
  const allowNetwork = process.env.PI_OFFLINE === undefined && options.allowModelNetwork === true;
  const runtime = await ModelRuntime.create({ ...sdkOptions, credentials, refreshOnCreate: false });
  // OAuth can exist only in auth.json; it need not create a models.json entry.
  // Read persisted IDs without creating auth.json after a worker profile was captured.
  const needed = new Set(providerScope ? [providerScope] : providerIds);
  if (credentials && !providerScope) {
    for (const credential of await credentials.list({ signal: options.signal })) needed.add(credential.providerId);
  } else if (!providerScope) {
    for (const provider of nativeProviders) {
      if (readStoredCredential(provider.template.id, options.authPath)) needed.add(provider.template.id);
    }
  }
  for (const provider of nativeProviders) {
    // Restore native registrations for configured providers and persisted credentials;
    // their models must not fall through to a generic OpenAI transport.
    if (needed.has(provider.template.id)) await registerModelProvider(runtime, provider.template.id);
  }
  if (configurationOnly) {
    // Parsing/composition only. Availability and credentials belong to a real
    // request; even reading their files here would recreate a model gate.
  } else if (metadataOnly) {
    // SDK refresh(allowNetwork:false) still checks auth and takes credential/store
    // locks. Restore only provider-owned cached metadata through the public cache
    // phase instead; Kiro's own account/profile scope validation remains intact.
    const storePath = options.modelsStorePath ?? (options.modelsPath === null ? undefined : join(options.modelsPath ? dirname(options.modelsPath) : getAgentDir(), "models-store.json"));
    // Parse the optional file only when a dynamic provider actually needs it.
    let stored: ReturnType<typeof catalogMetadata> | undefined;
    let fallbackSignal: AbortSignal | undefined;
    for (const providerId of needed) {
      const provider = runtime.getRegisteredNativeProvider(providerId);
      if (!provider?.refreshModels) continue;
      if (!options.modelsStore) stored ??= storePath ? catalogMetadata(storePath) : {};
      const signal = options.signal ?? (fallbackSignal ??= AbortSignal.timeout(5000));
      try {
        await provider.refreshModels({
          credential: await credentials!.read(providerId, { signal }),
          stored: options.modelsStore ? await options.modelsStore.read(providerId, { signal }) : stored?.[providerId],
          allowNetwork: false,
          signal,
          publish: async publication => {
            signal.throwIfAborted();
            // Display may update memory, never persist a refresh or deletion.
            if (publication.persist !== undefined) return false;
            publication.update?.();
            return true;
          },
        });
      } catch {
        // Match SDK refresh's per-provider isolation. A broken optional cache
        // must not prevent editing the configuration or other providers.
        signal.throwIfAborted();
      }
    }
  } else if (options.refreshOnCreate === false) {
    // Only restore an existing dynamic catalog. A cold/static runtime must not
    // invoke refresh: the SDK's store read creates a missing file during resource binding.
    const dynamic = nativeProviders.filter(item => needed.has(item.template.id) && runtime.getRegisteredNativeProvider(item.template.id)?.refreshModels).map(item => item.template.id);
    const storePath = options.modelsStorePath ?? (options.modelsPath === null ? undefined : join(options.modelsPath ? dirname(options.modelsPath) : getAgentDir(), "models-store.json"));
    if (dynamic.length && (options.modelsStore || storePath && existsSync(storePath)))
      await runtime.refresh({ providers: dynamic, allowNetwork: false, signal: options.signal });
  } else {
    const signal = allowNetwork && options.modelRefreshTimeoutMs !== undefined
      ? AbortSignal.any([...(options.signal ? [options.signal] : []), AbortSignal.timeout(options.modelRefreshTimeoutMs)])
      : options.signal;
    await runtime.refresh({ allowNetwork, signal });
  }
  installModelCopies(runtime, options.modelsPath === undefined ? join(getAgentDir(), "models.json") : options.modelsPath);
  return runtime;
}

/** A selected definition error, not advisory availability or authentication. */
export async function invalidModelDefinition(modelsPath: string, providerScope: string): Promise<boolean> {
  const runtime = await createModelRuntime({ modelsPath, providerScope, configurationOnly: true,
    allowModelNetwork: false, refreshOnCreate: false });
  return !!runtime.getError();
}
