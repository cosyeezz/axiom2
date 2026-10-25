import { inModelNetworkWorker, modelNetwork } from "./model-network.js";
import { parseProviderProxy, providerProxyUrl, providerProxyView, readProviderProxy } from "./integrations/model-proxy-env.js";
import { mkdirSync, readFileSync, realpathSync, watch } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, open, rename, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { homedir } from "node:os";
import {
  type ModelRuntime,
  ModelRegistry,
  CredentialSynchronizationError,
  readStoredCredential,
} from "@earendil-works/pi-coding-agent";
import {
  list,
  id,
  entries,
  levelsOf,
  prepareDraft,
  validateDraft,
  invalid,
} from "./models/draft.js";
import { createModelRuntime, ensureModelProvider, nativeProviderTemplates } from "./model-runtime.js";
import { discoverModels } from "./model-discovery.js";
import { kiroCatalogInput, kiroCatalogScope } from "./providers/kiro-catalog.js";
import type { KiroProvider } from "./providers/kiro.js";
import { AppError, object, text } from "../shared/protocol.js";
import {
  editableBodyOverride,
  modelCostKeys,
  emptyModelPricing,
  type ModelPricing,
  type ModelConfiguration,
  type ModelCatalog,
  type ProviderDraft,
  type OverrideRow,
} from "../shared/models.js";

// pi validates the full file. Only this editor's fields are changed; unrepresented fields stay on the server.
type Json = Record<string, any>;
const empty = '{"providers":{}}';
const digest = (raw: string) => createHash("sha256").update(raw).digest("hex");
function headersView(headers: Json = {}): OverrideRow[] {
  return Object.keys(headers).map((key) => ({
    id: randomUUID(),
    key,
    value: "",
    source: key,
    keep: true,
  }));
}
function bodyView(body: Json = {}): OverrideRow[] {
  return Object.entries(body)
    .filter(([key, value]) => editableBodyOverride(key, value))
    .map(([key, value]) => ({
      id: randomUUID(), key, value: String(value),
      valueType: typeof value === "number" ? "number" : "string",
    }));
}
function urlView(value: string): { url: string; keepUrl?: boolean } {
  try {
    const url = new URL(value);
    if (url.username || url.password || url.search || url.hash)
      return { url: "", keepUrl: true };
    return { url: value };
  } catch {
    return { url: "", keepUrl: true };
  }
}
export class ModelService {
  readonly dir: string;
  private tail: Promise<unknown> = Promise.resolve();
  authActive = false;
  beforeLogout?: (providers: string[], confirmed: boolean) => Promise<void>;
  constructor(readonly root: string, private readonly network: typeof modelNetwork | null = inModelNetworkWorker ? null : modelNetwork) {
    const configured = process.env.AXIOM_PI_DIR || join(root, "pi");
    const homeRelative = configured.startsWith("~/") || (process.platform === "win32" && configured.startsWith("~\\"));
    this.dir = resolve(configured === "~" ? homedir() : homeRelative ? join(homedir(), configured.slice(2)) : configured);
  }
  // Watchers only invalidate; admission still verifies content, including missed events and partial saves.
  watchConfiguration(changed: () => void): () => void {
    mkdirSync(this.dir, { recursive: true, mode: 0o700 });
    const revision = () => ["models.json", "auth.json", "models-store.json"].map(name => {
      try { return digest(readFileSync(join(this.dir, name), "utf8")); } catch { return "unreadable"; }
    }).join(":");
    let previous = revision();
    try {
      // Short Windows aliases can abort libuv before a JS error is emitted.
      const watcher = watch(realpathSync.native(this.dir), { persistent: false }, (_event, name) => {
        if (name && !["models.json", "auth.json", "models-store.json"].includes(String(name))) return;
        const next = revision();
        if (next !== previous) { previous = next; changed(); }
      });
      watcher.on("error", () => { changed(); watcher.close(); });
      return () => watcher.close();
    } catch { return () => {}; }
  }
  // ponytail: one application config writer; split locks only if independent config domains become necessary.
  serial<T>(run: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    const cancelled = () => new AppError("AGENT_STOPPED", "配置准备等待期间已停止；未发送请求。");
    if (signal?.aborted) return Promise.reject(cancelled());
    let entered = false;
    const result = this.tail.then(() => {
      if (signal?.aborted) throw cancelled();
      entered = true;
      return run();
    });
    this.tail = result.catch(() => {});
    if (!signal) return result;
    // A logout writer may be waiting for this startup to stop. Cancel queued
    // work without waiting for that writer; work already entered must finish.
    return new Promise<T>((resolve, reject) => {
      const abort = () => { if (!entered) reject(cancelled()); };
      signal.addEventListener("abort", abort, { once: true });
      result.then(value => { signal.removeEventListener("abort", abort); resolve(value); },
        error => { signal.removeEventListener("abort", abort); reject(error); });
      if (signal.aborted) abort();
    });
  }
  async raw() {
    await mkdir(this.dir, { recursive: true, mode: 0o700 });
    try {
      return await readFile(join(this.dir, "models.json"), "utf8");
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return empty;
      throw new AppError("CONFIG_READ_FAILED", "配置无法读取；未覆盖原文件。");
    }
  }
  async runtime(path = join(this.dir, "models.json")) {
    let providerIds: string[] = [];
    try { providerIds = Object.keys(JSON.parse((await readFile(path, "utf8")).replace(/^\uFEFF/, "")).providers ?? {}); }
    catch { /* The SDK below retains configuration read/validation diagnostics. */ }
    return createModelRuntime({
      providerIds,
      modelsPath: path,
      authPath: join(this.dir, "auth.json"),
      modelsStorePath: join(this.dir, "models-store.json"),
      allowModelNetwork: false,
      refreshOnCreate: false,
    });
  }
  /** Complete expiring OAuth rotation before an execution environment snapshots auth.json. */
  async prepareAuth(selection: { provider: string; id: string }, modelsPath: string, signal: AbortSignal) {
    signal.throwIfAborted();
    const credential = readStoredCredential(selection.provider, join(this.dir, "auth.json"));
    // API keys and fresh OAuth need no network operation. Keep checkAuth read-only.
    // Leave a 30s binding margin beyond Pi's five-minute refresh window.
    if (credential?.type !== "oauth" || credential.expires > Date.now() + 330_000) return;
    let ready: boolean;
    if (this.network) {
      ready = await this.network<boolean>(this.root, this.dir, selection.provider, modelsPath, "prepareAuth",
        { modelId: selection.id }, { signal });
    } else {
      const runtime = await this.runtime(modelsPath);
      await ensureModelProvider(runtime, selection.provider);
      const model = runtime.getModel(selection.provider, selection.id);
      ready = !!(model && await runtime.getAuth(model, { signal, minOAuthValidityMs: 330_000 }));
    }
    signal.throwIfAborted();
    if (!ready) throw new AppError("MODEL_UNAVAILABLE", "模型认证已失效；未发送请求，请重新登录。");
  }
  async load() {
    const raw = await this.raw();
    let config: Json;
    try {
      config = object(JSON.parse(raw));
      object(config.providers);
      if (Buffer.byteLength(raw) > 1_000_000) throw Error();
      for (const [provider, value] of Object.entries(config.providers)) {
        id(provider, "供应商 ID");
        const p = object(value);
        if (p.models !== undefined) {
          const seen = new Set<string>();
          for (const m of list(p.models, 1000)) {
            const key = id(object(m).id, "模型 ID");
            if (seen.has(key)) throw Error();
            seen.add(key);
          }
        }
        if (p.modelOverrides !== undefined) object(p.modelOverrides);
      }
    } catch {
      throw new AppError(
        "CONFIG_READ_FAILED",
        "配置不是可编辑的有效 JSON 或存在重复 ID；原文件未覆盖。",
      );
    }
    const runtime = await this.runtime();
    if (runtime.getError())
      throw new AppError(
        "CONFIG_READ_FAILED",
        "pi 配置校验失败；原文件未覆盖。",
      );
    // Credentials are also a native provider registration: OAuth need not create a custom endpoint first.
    for (const credential of await runtime.listCredentials())
      config.providers[credential.providerId] ??= {};
    // Restore pi's cached metadata after validating the file. Auth failures remain
    // separate from configuration validity and are reported by auth/save operations.
    await runtime.refresh({ providers: Object.keys(config.providers), allowNetwork: false, signal: AbortSignal.timeout(5000) });
    if (digest(await this.raw()) !== digest(raw))
      throw new AppError(
        "REVISION_CONFLICT",
        "读取期间配置已改变；请重新读取。",
      );
    return { raw, config, runtime, revision: digest(raw) };
  }
  private async storeApiKey(runtime: ModelRuntime, providerId: string, key: string, migrating = false) {
    if (this.network) {
      if (migrating && readStoredCredential(providerId, join(this.dir, "auth.json")))
        throw new AppError("REVISION_CONFLICT", "认证在迁移期间已改变；原密钥已保留，请重新读取。");
      return this.network<void>(this.root, this.dir, providerId, join(this.dir, "models.json"), "storeKey", { key }, { signal: AbortSignal.timeout(15000) });
    }
    let supplied = false;
    await runtime.login(providerId, "api_key", {
      signal: AbortSignal.timeout(15000),
      notify: () => {},
      prompt: async (prompt) => {
        if (prompt.type !== "secret" || supplied)
          throw new AppError("AUTH_INTERACTION_REQUIRED", "该供应商需要额外认证步骤，请使用单独登录流程。");
        if (migrating && readStoredCredential(providerId, join(this.dir, "auth.json")))
          throw new AppError("REVISION_CONFLICT", "认证在迁移期间已改变；原密钥已保留，请重新读取。");
        supplied = true;
        return key;
      },
    });
  }
  // Called only inside serial(). Persist and verify credentials before removing
  // legacy keys; an existing auth.json entry (including OAuth) always wins.
  private async normalizeCredentials(state: Awaited<ReturnType<ModelService["load"]>>, onlyProvider?: string) {
    const candidate: Json = JSON.parse(state.raw);
    const legacy = Object.entries(candidate.providers).filter(([providerId, value]) =>
      (!onlyProvider || providerId === onlyProvider) && Object.hasOwn(value as Json, "apiKey")) as [string, Json][];
    if (!legacy.length || this.authActive) return state;
    const path = join(this.dir, `models-credentials-${randomUUID()}.tmp`);
    const signal = AbortSignal.timeout(15000);
    const removed: string[] = [];
    try {
      for (const [providerId, provider] of legacy) {
        if (digest(await this.raw()) !== state.revision)
          throw new AppError("REVISION_CONFLICT", "密钥迁移期间配置已改变；原配置未覆盖，请重新读取。");
        if (this.authActive) throw new AppError("AUTH_BUSY", "请先完成或取消正在进行的认证");
        const current = await this.runtime();
        const stored = await current.listCredentials({ signal });
        if (!stored.some((item) => item.providerId === providerId)) {
          // An empty legacy value is a repairable missing-key state, not a migration.
          if (typeof provider.apiKey !== "string" || !provider.apiKey.trim()) continue;
          // Keep expressions intact: pi resolves environment/command values at use time.
          try { await this.storeApiKey(current, providerId, provider.apiKey, true); }
          catch (error) {
            // A stopped proxy must not make the connection editor inaccessible.
            // Keep the legacy key intact until its configured route is available.
            if (error instanceof AppError && error.code === "PROXY_UNAVAILABLE") continue;
            throw error;
          }
          const persisted = readStoredCredential(providerId, join(this.dir, "auth.json"));
          if (persisted?.type !== "api_key" || persisted.key !== provider.apiKey)
            throw new AppError("CREDENTIAL_NOT_PERSISTED", "未能确认密钥已保存到 auth.json；models.json 中的密钥已保留。");
        }
        delete provider.apiKey;
        removed.push(providerId);
      }
      if (!removed.length) return state;
      // Compare credential bytes too: a concurrent logout must not discard the source.
      const authRevision = digest(await readFile(join(this.dir, "auth.json"), "utf8"));
      const stored = await (await this.runtime()).listCredentials({ signal });
      if (removed.some((providerId) => !stored.some((item) => item.providerId === providerId)))
        throw new AppError("CREDENTIAL_NOT_PERSISTED", "未能确认密钥已保存到 auth.json；models.json 中的密钥已保留。");
      const file = await open(path, "wx", 0o600);
      try {
        await file.writeFile(JSON.stringify(candidate, null, 2) + "\n");
        await file.sync();
      } finally { await file.close(); }
      const checked = await this.runtime(path);
      if (checked.getError()) throw new AppError("INVALID_CONFIG", "密钥迁移后的配置未通过校验；models.json 中的密钥已保留。");
      if (digest(await this.raw()) !== state.revision ||
          digest(await readFile(join(this.dir, "auth.json"), "utf8")) !== authRevision)
        throw new AppError("REVISION_CONFLICT", "密钥迁移期间配置或认证已改变；原配置未覆盖，请重新读取。");
      if (this.authActive) throw new AppError("AUTH_BUSY", "请先完成或取消正在进行的认证");
      await rename(path, join(this.dir, "models.json"));
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError("CREDENTIAL_MIGRATION_FAILED", "密钥存储同步未完成；models.json 中的密钥已保留，请重新读取后重试。");
    } finally { await rm(path, { force: true }); }
    return this.load();
  }
  read(options: { normalizeCredentials?: boolean } = {}): Promise<ModelConfiguration> {
    return this.serial(() => this.readConfiguration(options.normalizeCredentials !== false));
  }
  private async readConfiguration(normalize: boolean): Promise<ModelConfiguration> {
    const state = await this.load();
    const { config, runtime, revision } = normalize ? await this.normalizeCredentials(state) : state;
    const credentials = await runtime.listCredentials();
    const providerEntries = Object.entries(config.providers) as [string, Json][];
    // Credential checks are independent; one failing provider must not delay or
    // hide the status of the others.
    const checks = await Promise.all(providerEntries.map(async ([providerId]) => {
      try { return [providerId, await this.checkAuth(runtime, providerId)] as const; }
      catch (error) { return [providerId, undefined, error instanceof AppError ? error.message : "无法检查认证，请检查供应商代理设置。"] as const; }
    }));
    const auth = new Map(checks.map(([providerId, check, error]) => [providerId, { check, error }]));
    const providers: ProviderDraft[] = [];
    for (const [providerId, p] of providerEntries) {
      const provider = runtime.getProvider(providerId);
      const { check, error: connectionError } = auth.get(providerId)!;
      const credential = credentials.find((item) => item.providerId === providerId);
      const oauth = credential?.type === "oauth" || (!credential && provider?.auth.oauth && !p.baseUrl && !p.api && !p.apiKey);
      providers.push({
        id: providerId,
        originalId: providerId,
        providerId,
        connectionType: credentials.find((c) => c.providerId === providerId)?.type === "oauth" ||
          (!credentials.some((c) => c.providerId === providerId) && provider?.auth.oauth && !p.baseUrl && !p.api && !p.apiKey)
          ? "oauth" : "custom",
        hasConnectionOverrides: !!(p.baseUrl || p.api || p.apiKey),
        name: p.name ?? provider?.name ?? providerId,
        api: p.api ?? provider?.getModels()[0]?.api ?? (providerId === "kiro" ? "kiro-chat" : "openai-completions"),
        ...urlView(
          p.baseUrl ??
            provider?.baseUrl ??
            runtime.getModels(providerId)[0]?.baseUrl ??
            "",
        ),
        proxy: providerProxyView(p.axiomProxy),
        key: "",
        headers: headersView(p.headers),
        body: [],
        auth: {
          configured: !!credential && (!!check || !!connectionError),
          error: connectionError ?? (!oauth && (!credential || !check)
            ? "未配置有效 API 密钥：请填写密钥并保存到 auth.json 后重试。"
            : undefined),
          source: credentials.some((c) => c.providerId === providerId)
            ? "stored"
            : (runtime.getProviderAuthStatus(providerId).source ??
              (check ? "environment" : undefined)),
          type:
            credentials.find((c) => c.providerId === providerId)?.type ??
            check?.type,
          methods: [
            ...(provider?.auth.apiKey?.login ? ["api_key" as const] : []),
            ...(provider?.auth.oauth ? ["oauth" as const] : []),
          ],
        },
        models: [...entries(p)].map(([modelId, m]) => ({
          key: modelId,
          originalId: modelId,
          id: m.axiomRequestModelId ?? modelId,
          ...(m.axiomRequestModelId ? { configId: modelId } : {}),
          name:
            m.name ?? runtime.getModel(providerId, modelId)?.name ?? modelId,
          levels: levelsOf(runtime.getModel(providerId, modelId)),
          input: [...(runtime.getModel(providerId, modelId)?.input ?? m.input ?? ["text"])],
          cost: Object.fromEntries(modelCostKeys.map(key => [key, runtime.getModel(providerId, modelId)?.cost[key] ?? m.cost?.[key] ?? emptyModelPricing()[key]])) as ModelPricing,
          costTiered: !!runtime.getModel(providerId, modelId)?.cost.tiers?.length,
          headers: headersView(m.headers),
          body: bodyView(m.samplingParams),
          bodyVersion: 2,
        })),
      });
    }
    return {
      revision,
      providers,
      storage: {
        modelsPath: join(this.dir, "models.json"),
        authPath: join(this.dir, "auth.json"),
      },
      templates: [...new Map<string, ModelConfiguration["templates"][number]>([
        ...nativeProviderTemplates().map((p): [string, ModelConfiguration["templates"][number]] => [p.id, { ...p, methods: [...(p.methods ?? [])] }]),
        ...runtime.getProviders().map((p): [string, ModelConfiguration["templates"][number]] => [p.id, {
        id: p.id,
        name: p.name,
        api: p.getModels()[0]?.api ?? (p.id === "kiro" ? "kiro-chat" : "openai-completions"),
        url: urlView(p.baseUrl ?? p.getModels()[0]?.baseUrl ?? "").url,
        methods: [
          ...(p.auth.apiKey?.login ? ["api_key" as const] : []),
          ...(p.auth.oauth?.login ? ["oauth" as const] : []),
        ],
      }]),
      ]).values()],
    };
  }
  // Discovery uses connection settings only. models.json is the import target;
  // its models and modelOverrides must never become catalog entries or metadata.
  private async withCatalogRuntime<T>(providerId: string, connection: Json, run: (runtime: ModelRuntime) => Promise<T>): Promise<T> {
    // Apply authHeader at the HTTP boundary so explicit provider headers keep precedence.
    const { models: _models, modelOverrides: _overrides, authHeader: _authHeader, ...settings } = connection;
    const path = join(this.dir, `models-catalog-${randomUUID()}.tmp`);
    try {
      const file = await open(path, "wx", 0o600);
      try {
        await file.writeFile(JSON.stringify({ providers: { [providerId]: { ...settings, headers: settings.headers ?? {} } } }));
      } finally {
        await file.close();
      }
      const runtime = await this.runtime(path);
      if (runtime.getError()) throw new AppError("CONFIG_READ_FAILED", "供应商连接配置无法用于读取模型目录。");
      await runtime.refresh({ providers: [providerId], allowNetwork: false, signal: AbortSignal.timeout(5000) });
      return await run(runtime);
    } finally {
      await rm(path, { force: true });
    }
  }
  // Credential presence is local metadata: checking it never opens a provider
  // connection, so it must not pay for a per-provider network worker. The route
  // is still resolved first, keeping a stopped proxy an explicit auth error.
  async checkAuth(runtime: ModelRuntime, providerId: string) {
    if (this.network) providerProxyUrl(this.root, readProviderProxy(join(this.dir, "models.json"), providerId));
    return runtime.checkAuth(providerId, { signal: AbortSignal.timeout(5000) });
  }
  catalog(provider: unknown, expectedRevision: unknown, cancellation?: AbortSignal): Promise<ModelCatalog> {
    if (this.network) return this.serial(() => {
      if (this.authActive) throw new AppError("AUTH_BUSY", "请先完成或取消正在进行的认证");
      return this.network!<ModelCatalog>(this.root, this.dir, id(provider, "供应商 ID"), join(this.dir, "models.json"), "catalog", { revision: expectedRevision }, { signal: cancellation });
    }, cancellation);
    return this.serial(async () => {
      if (this.authActive) throw new AppError("AUTH_BUSY", "请先完成或取消正在进行的认证");
      const providerId = id(provider, "供应商 ID");
      let state = await this.load();
      if (expectedRevision !== state.revision)
        throw new AppError("REVISION_CONFLICT", "配置已改变，请重新读取后拉取模型列表。");
      // This worker owns only this provider's network and must not log in
      // another provider while normalizing legacy credentials.
      state = await this.normalizeCredentials(state, providerId);
      const { config, revision } = state;
      if (expectedRevision !== revision)
        throw new AppError("REVISION_CONFLICT", "密钥已统一保存到 auth.json，请重新读取配置后拉取模型列表。");
      if (!Object.hasOwn(config.providers, providerId))
        throw new AppError("NOT_FOUND", "请先保存供应商连接配置，再拉取模型列表。");
      return this.withCatalogRuntime(providerId, config.providers[providerId], async (runtime) => {
        const native = runtime.getProvider(providerId);
        if (!native) throw new AppError("NOT_FOUND", "pi 未识别该供应商，请检查连接配置。");
        const connection = config.providers[providerId];
        const credential = (await runtime.listCredentials()).find((item) => item.providerId === providerId);
        const oauth = connection.oauth === "radius" || (!connection.baseUrl &&
          (credential?.type === "oauth" || (!credential && native.auth.oauth && !connection.api && !connection.apiKey)));
        // Qoder's PAT and device-token connections share a signed catalog, not /models.
        const qoderCatalog = (providerId === "qoder" || providerId === "qoder-cn") && !!native.refreshModels;
        const kiroCatalog = providerId === "kiro" && !!native.refreshModels;
        if (kiroCatalog && connection.baseUrl)
          throw new AppError("MODEL_DISCOVERY_FAILED", "Kiro 原生目录使用固定 AWS 服务端点，不支持自定义 Base URL；不会向该地址发送账号令牌。");
        if (qoderCatalog && connection.baseUrl && connection.baseUrl !== native.baseUrl)
          throw new AppError("MODEL_DISCOVERY_FAILED", "Qoder 原生接入使用固定地区接口，不支持自定义 Base URL。请使用其他供应商 ID 配置代理。");
        const signal = cancellation ? AbortSignal.any([cancellation, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000);
        let models: ModelCatalog["models"];
        let source: ModelCatalog["source"];
        let message: string;
        try {
          if (!oauth && !qoderCatalog && !kiroCatalog) {
            if (!credential)
              throw new AppError("MODEL_AUTH_MISSING", "未配置 API 密钥：auth.json 和 models.json 中均无该供应商密钥，请填写密钥并保存后重试。");
            const baseUrl = connection.baseUrl ?? native.baseUrl ?? runtime.getModels(providerId)[0]?.baseUrl;
            if (!baseUrl) throw new AppError("MODEL_DISCOVERY_FAILED", "请先配置 Base URL，再拉取模型列表。");
            const api = connection.api ?? runtime.getModels(providerId)[0]?.api;
            // A request descriptor lets pi resolve provider headers even without an API key.
            // It is never registered, persisted, or returned as a discovered model.
            const auth = await new ModelRegistry(runtime).getApiKeyAndHeaders({
              id: "axiom-model-discovery", name: "Model discovery", provider: providerId, api, baseUrl,
              input: ["text"], reasoning: false, contextWindow: 0, maxTokens: 0,
              cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
            });
            if (!auth.ok) throw new AppError("MODEL_DISCOVERY_FAILED", "无法解析接口认证或请求头，请检查连接配置后重试。");
            if (credential.type === "api_key" && !auth.apiKey)
              throw new AppError("MODEL_AUTH_MISSING", "auth.json 中的 API 密钥无法解析，请检查密钥配置后重试。");
            const discovered = await discoverModels({ baseUrl, api, auth, authHeader: connection.authHeader === true, signal });
            models = discovered.map((model) => {
              // Native metadata can describe a returned ID, but cannot add identities to the response.
              // This runtime excludes all models and overrides in the target configuration.
              const candidate = runtime.getModel(providerId, model.id);
              const known = candidate?.api === api ? candidate : undefined;
              return { ...model, api,
                levels: known ? levelsOf(known) : undefined,
                input: known ? [...known.input] : undefined, contextWindow: known?.contextWindow };
            });
            source = "endpoint";
            message = "已从当前 Base URL 拉取模型列表。接口未提供的能力参考 pi 原生目录；未知能力请在添加后确认。";
          } else {
            if (!await runtime.checkAuth(providerId, { signal }))
              throw new AppError("MODEL_DISCOVERY_FAILED", qoderCatalog ? "请先登录 Qoder 或保存 Personal Access Token，再拉取模型列表。" : "请先完成 OAuth 登录，再拉取模型列表。");
            if (native.refreshModels) {
              const kiroNative = kiroCatalog ? runtime.getRegisteredNativeProvider("kiro") as KiroProvider | undefined : undefined;
              const before = kiroNative?.catalogState().generation;
              const result = await runtime.refresh({ providers: [providerId], allowNetwork: true, force: true, signal });
              if (result.aborted || result.errors.size)
                throw new AppError("MODEL_DISCOVERY_FAILED", kiroCatalog && !result.aborted && result.errors.get(providerId)
                  ? result.errors.get(providerId)!.message
                  : "OAuth 模型目录刷新未完成，请检查网络和认证后重试。");
              if (kiroCatalog) {
                const after = kiroNative?.catalogState();
                const current = kiroCatalogScope(readStoredCredential("kiro", join(this.dir, "auth.json")));
                if (before === undefined || !after || after.generation <= before || !current || after.scope !== current)
                  throw new AppError("MODEL_DISCOVERY_FAILED", "Kiro 目录未完成本次实时拉取，或认证在刷新期间已改变；请重新读取认证状态后重试。");
              }
            }
            source = "native";
            message = providerId === "kiro"
              ? "已通过 Kiro CLI 原生接口实时拉取当前账号模型目录。添加后可使用原生文本聊天与工具调用；图片能力按目录 IMAGE 声明展示，缺字段不代表模型不支持。思考等级按 kiro.rs 兼容配置展示并发送，不代表上游能力声明；未识别模型需确认后手动配置。账号权限以服务端为准，零值单价不代表免费。"
              : qoderCatalog
              ? "已通过 Qoder 签名接口刷新账号模型目录；不代表已验证真实推理权限。当前接入仅声明文本能力，单价未核验。"
              : native.refreshModels
              ? "此 OAuth 连接使用 pi 原生目录，可能包含内置或缓存项；不是 Base URL 接口返回的模型列表。"
              : "此 OAuth 连接使用应用内置模型目录；未向供应商查询实时列表，实际可用性以账号权限为准。";
            models = runtime.getModels(providerId).map((model) => ({
              id: model.id, name: model.name, api: model.api,
              levels: levelsOf(model), input: kiroCatalog ? kiroCatalogInput(model) : [...model.input], contextWindow: kiroCatalog ? model.contextWindow || undefined : model.contextWindow,
            })).sort((a, b) => a.name.localeCompare(b.name));
            if (kiroCatalog && !models.length) message = "Kiro 接口请求成功，但当前账号未返回模型；请检查账号权限及所选 profile，不会回退到静态名单或其他模型。";
          }
        } catch (error) {
          if (error instanceof AppError) throw error;
          throw new AppError("MODEL_DISCOVERY_FAILED", signal.aborted
            ? "模型列表请求超时，请稍后重试。"
            : "模型列表请求失败，请检查接口地址、网络、认证和请求头后重试。");
        }
        if (digest(await this.raw()) !== revision)
          throw new AppError("REVISION_CONFLICT", "拉取期间配置已改变，请重新读取后重试。");
        return { providerId, revision, source, message, models };
      });
    }, cancellation);
  }
  /** Called after login admission, while authActive excludes other configuration writers. */
  configureLoginProxy(providerId: string, value: unknown, expectedRevision: string) {
    return this.serial(async () => {
      const { raw, revision } = await this.load();
      if (revision !== expectedRevision)
        throw new AppError("REVISION_CONFLICT", "配置已改变，请重新读取后认证。");
      const candidate = JSON.parse(raw);
      const previous = candidate.providers[providerId]?.axiomProxy;
      const proxy = parseProviderProxy(value, previous);
      // Validate before publishing or opening the browser; never fall back to direct.
      providerProxyUrl(this.root, proxy);
      if (JSON.stringify(proxy) === JSON.stringify(parseProviderProxy(previous))) return;
      // pi rejects a provider containing only app metadata. Empty headers are a
      // no-op native override: retain its own endpoints, protocols and models.
      candidate.providers[providerId] ??= { headers: {} };
      candidate.providers[providerId].axiomProxy = proxy;
      const next = JSON.stringify(candidate, null, 2) + "\n";
      if (Buffer.byteLength(next) > 1_000_000) invalid("配置超过 1 MB 上限");
      const path = join(this.dir, `models-login-${randomUUID()}.tmp`);
      try {
        const file = await open(path, "wx", 0o600);
        try { await file.writeFile(next); await file.sync(); }
        finally { await file.close(); }
        const checked = await this.runtime(path);
        if (checked.getError()) invalid("pi 拒绝此代理配置；原文件未覆盖。");
        if (digest(await this.raw()) !== revision)
          throw new AppError("REVISION_CONFLICT", "配置已改变；未覆盖，请重新读取后认证。");
        await rename(path, join(this.dir, "models.json"));
      } catch (error) {
        if (error instanceof AppError) throw error;
        throw new AppError("CONFIG_WRITE_FAILED", "授权代理配置保存失败，请重新读取后重试。");
      } finally { await rm(path, { force: true }).catch(() => {}); }
    });
  }
  save(input: unknown): Promise<{ revision: string; loggedOut: string[] }> {
    return this.serial(async () => {
      if (this.authActive)
        throw new AppError("AUTH_BUSY", "请先完成或取消正在进行的认证");
      const draft = object(input),
        { config, runtime, revision } = await this.load();
      if (draft.revision !== revision)
        throw new AppError(
          "REVISION_CONFLICT",
          "配置已被修改；保留本页草稿，请重新读取后合并。",
        );
      // New OAuth/custom drafts may refer to a native provider absent from disk.
      if (Array.isArray(draft.providers)) {
        for (const p of draft.providers) {
          // Existing disabled experimental entries remain editable/removable;
          // only adding a provider is an explicit enable operation here.
          if (p && typeof p.providerId === "string" && !Object.hasOwn(config.providers, p.providerId)) await ensureModelProvider(runtime, p.providerId);
        }
      }
      const { candidate, providers, logout, keys } = prepareDraft(
        draft,
        config,
        runtime,
      );
      const raw = JSON.stringify(candidate, null, 2) + "\n";
      if (Buffer.byteLength(raw) > 1_000_000) invalid("配置超过 1 MB 上限");
      const path = join(this.dir, `models-${randomUUID()}.tmp`);
      let published = false,
        credentialsChanged = false;
      try {
        const file = await open(path, "wx", 0o600);
        try {
          await file.writeFile(raw);
          await file.sync();
        } finally {
          await file.close();
        }
        const checked = await this.runtime(path);
        if (checked.getError())
          invalid(
            "pi 拒绝此配置；请检查协议、模型能力与覆盖项。原文件未覆盖。",
          );
        await checked.refresh({ providers: Object.keys(providers), allowNetwork: false, signal: AbortSignal.timeout(5000) });
        validateDraft(draft, providers, keys, checked);
        if (digest(await this.raw()) !== revision)
          throw new AppError(
            "REVISION_CONFLICT",
            "验证期间配置已改变；未覆盖，请重新读取。",
          );
        await this.beforeLogout?.([...logout], draft.confirmStop === true);
        if (digest(await this.raw()) !== revision)
          throw new AppError(
            "REVISION_CONFLICT",
            "停止执行期间配置已改变；请重新读取。",
          );
        for (const providerId of logout) {
          // Native logout deletes local credentials and refreshes cached metadata.
          // It must remain possible to remove a provider whose proxy is stopped.
          await runtime.logout(providerId); await runtime.removeRuntimeApiKey(providerId);
          credentialsChanged = true;
        }
        if (digest(await this.raw()) !== revision)
          throw new AppError(
            "REVISION_CONFLICT",
            "认证处理期间配置已改变；未覆盖，请重新读取。",
          );
        await rename(path, join(this.dir, "models.json"));
        published = true;
        const active = await this.runtime();
        for (const [providerId, key] of keys) {
          await this.storeApiKey(active, providerId, key);
          credentialsChanged = true;
        }
        // Reopen the on-disk store: an in-memory login alone must not count as saved.
        const persisted = await this.runtime();
        const stored = await persisted.listCredentials();
        for (const providerId of keys.keys())
          if (!stored.some((c) => c.providerId === providerId && c.type === "api_key"))
            throw new AppError(
              "CREDENTIAL_NOT_PERSISTED",
              "未能从本地认证文件重新读取已保存的 API 密钥。",
            );
        // Saving connection settings must also work while the chosen proxy is stopped.
        // Connectivity and token refresh are checked when making the next network request.
        if (persisted.getError()) throw Error();
        const normalized = await this.normalizeCredentials(await this.load());
        return { revision: normalized.revision, loggedOut: [...logout] };
      } catch (error) {
        if (
          published ||
          credentialsChanged ||
          error instanceof CredentialSynchronizationError
        )
          throw new AppError(
            "PARTIAL_CONFIG_FAILURE",
            `配置${published ? "已写入" : "未写入"}；认证或目录同步未全部完成。请重新读取配置与认证状态，勿盲目重复登录。`,
          );
        if (error instanceof AppError) throw error;
        throw new AppError(
          "CONFIG_WRITE_FAILED",
          "配置发布失败；未确认任何成功，请重新读取配置与认证状态。",
        );
      } finally {
        await rm(path, { force: true }).catch(() => {});
      }
    });
  }
}
