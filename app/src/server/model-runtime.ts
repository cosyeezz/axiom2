import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { getAgentDir, ModelRuntime, readStoredCredential } from "@earendil-works/pi-coding-agent";
import type { ModelConfiguration } from "../shared/models.js";

type Template = ModelConfiguration["templates"][number];
const nativeProviders = [{
  template: { id: "codebuddy-cn", name: "CodeBuddy 国内版", api: "openai-completions", url: "https://copilot.tencent.com/v2", methods: ["api_key", "oauth"] } satisfies Template,
  load: async () => (await import("./providers/codebuddy-cn.js")).codeBuddyProvider(),
}, {
  template: { id: "kiro", name: "kiro", api: "kiro-auth-only", url: "", methods: ["oauth"] } satisfies Template,
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
  try { runtime.registerNativeProvider(provider); }
  finally { runtime.refresh = refresh; }
}

type RuntimeOptions = Parameters<typeof ModelRuntime.create>[0] & {
  /** IDs from the application's validated configuration or an explicit user action. */
  providerIds?: readonly string[];
};

export async function createModelRuntime(options: RuntimeOptions = {}) {
  const { providerIds = [], ...sdkOptions } = options;
  const allowNetwork = process.env.PI_OFFLINE === undefined && options.allowModelNetwork === true;
  const runtime = await ModelRuntime.create({ ...sdkOptions, refreshOnCreate: false });
  // OAuth can exist only in auth.json; it need not create a models.json entry.
  // Read persisted IDs without creating auth.json after a worker profile was captured.
  const needed = new Set(providerIds);
  if (options.credentials) {
    for (const credential of await options.credentials.list({ signal: options.signal })) needed.add(credential.providerId);
  } else {
    for (const provider of nativeProviders) {
      if (readStoredCredential(provider.template.id, options.authPath)) needed.add(provider.template.id);
    }
  }
  for (const provider of nativeProviders) {
    // Restore native registrations for configured providers and persisted credentials;
    // their models must not fall through to a generic OpenAI transport.
    if (needed.has(provider.template.id)) await registerModelProvider(runtime, provider.template.id);
  }
  if (options.refreshOnCreate === false) {
    // Only restore an existing dynamic catalog. A cold/static runtime must not
    // invoke refresh: the SDK's store read creates a missing file and invalidates snapshots.
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
  return runtime;
}
