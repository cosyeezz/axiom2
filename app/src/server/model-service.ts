import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, open, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import {
  ModelRuntime,
  ModelRegistry,
  CredentialSynchronizationError,
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
import { discoverModels } from "./model-discovery.js";
import { AppError, object, text } from "../shared/protocol.js";
import {
  samplingKeys,
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
    .filter(
      ([key, value]) =>
        samplingKeys.includes(key as any) && typeof value === "number",
    )
    .map(([key, value]) => ({ id: randomUUID(), key, value: String(value) }));
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
  constructor(readonly root: string) {
    this.dir = process.env.AXIOM_PI_DIR || join(root, "pi");
  }
  // ponytail: one application config writer; split locks only if independent config domains become necessary.
  serial<T>(run: () => Promise<T>): Promise<T> {
    const result = this.tail.then(run);
    this.tail = result.catch(() => {});
    return result;
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
    return ModelRuntime.create({
      modelsPath: path,
      authPath: join(this.dir, "auth.json"),
      modelsStorePath: join(this.dir, "models-store.json"),
      allowModelNetwork: false,
      refreshOnCreate: false,
    });
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
  async read(): Promise<ModelConfiguration> {
    const { config, runtime, revision } = await this.load();
    const credentials = await runtime.listCredentials();
    const providers: ProviderDraft[] = [];
    for (const [providerId, p] of Object.entries(config.providers) as [
      string,
      Json,
    ][]) {
      const provider = runtime.getProvider(providerId),
        check = await runtime.checkAuth(providerId, {
          signal: AbortSignal.timeout(5000),
        });
      providers.push({
        id: providerId,
        originalId: providerId,
        providerId,
        connectionType: credentials.find((c) => c.providerId === providerId)?.type === "oauth" ||
          (!credentials.some((c) => c.providerId === providerId) && provider?.auth.oauth && !p.baseUrl && !p.api && !p.apiKey)
          ? "oauth" : "custom",
        hasConnectionOverrides: !!(p.baseUrl || p.api || p.apiKey),
        name: p.name ?? provider?.name ?? providerId,
        api: p.api ?? provider?.getModels()[0]?.api ?? "openai-completions",
        ...urlView(
          p.baseUrl ??
            provider?.baseUrl ??
            runtime.getModels(providerId)[0]?.baseUrl ??
            "",
        ),
        key: "",
        headers: headersView(p.headers),
        body: [],
        auth: {
          configured: !!check,
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
          id: modelId,
          name:
            m.name ?? runtime.getModel(providerId, modelId)?.name ?? modelId,
          levels: levelsOf(runtime.getModel(providerId, modelId)),
          input: [...(runtime.getModel(providerId, modelId)?.input ?? m.input ?? ["text"])],
          headers: headersView(m.headers),
          body: bodyView(m.samplingParams),
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
      templates: runtime.getProviders().map((p) => ({
        id: p.id,
        name: p.name,
        api: p.getModels()[0]?.api ?? "openai-completions",
        url: urlView(p.baseUrl ?? p.getModels()[0]?.baseUrl ?? "").url,
        methods: [
          ...(p.auth.apiKey?.login ? ["api_key" as const] : []),
          ...(p.auth.oauth?.login ? ["oauth" as const] : []),
        ],
      })),
    };
  }
  // Discovery uses connection settings only. models.json is the import target;
  // its models and modelOverrides must never become catalog entries or metadata.
  private async withCatalogRuntime<T>(providerId: string, connection: Json, run: (runtime: ModelRuntime) => Promise<T>): Promise<T> {
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
  catalog(provider: unknown, expectedRevision: unknown): Promise<ModelCatalog> {
    return this.serial(async () => {
      if (this.authActive) throw new AppError("AUTH_BUSY", "请先完成或取消正在进行的认证");
      const providerId = id(provider, "供应商 ID");
      const { config, revision } = await this.load();
      if (expectedRevision !== revision)
        throw new AppError("REVISION_CONFLICT", "配置已改变，请重新读取后拉取模型列表。");
      if (!Object.hasOwn(config.providers, providerId))
        throw new AppError("NOT_FOUND", "请先保存供应商连接配置，再拉取模型列表。");
      return this.withCatalogRuntime(providerId, config.providers[providerId], async (runtime) => {
        const native = runtime.getProvider(providerId);
        if (!native) throw new AppError("NOT_FOUND", "pi 未识别该供应商，请检查连接配置。");
        const connection = config.providers[providerId];
        const credential = (await runtime.listCredentials()).find((item) => item.providerId === providerId);
        const oauth = connection.oauth === "radius" || (!connection.baseUrl &&
          (credential?.type === "oauth" || (!credential && native.auth.oauth && !connection.api && !connection.apiKey)));
        const signal = AbortSignal.timeout(15000);
        let models: ModelCatalog["models"];
        let source: ModelCatalog["source"];
        let message: string;
        try {
          if (!oauth) {
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
            const discovered = await discoverModels({ baseUrl, api, auth, signal });
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
            if (!native.refreshModels) throw new AppError("MODEL_DISCOVERY_FAILED", "该 OAuth 供应商不支持模型目录刷新，请手动添加模型。");
            if (!await runtime.checkAuth(providerId, { signal }))
              throw new AppError("MODEL_DISCOVERY_FAILED", "请先完成 OAuth 登录，再拉取模型列表。");
            const result = await runtime.refresh({ providers: [providerId], allowNetwork: true, force: true, signal });
            if (result.aborted || result.errors.size)
              throw new AppError("MODEL_DISCOVERY_FAILED", "OAuth 模型目录刷新未完成，请检查网络和认证后重试。");
            source = "native";
            message = "此 OAuth 连接使用 pi 原生目录，可能包含内置或缓存项；不是 Base URL 接口返回的模型列表。";
            models = runtime.getModels(providerId).map((model) => ({
              id: model.id, name: model.name, api: model.api,
              levels: levelsOf(model), input: [...model.input], contextWindow: model.contextWindow,
            })).sort((a, b) => a.name.localeCompare(b.name));
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
          await runtime.logout(providerId);
          credentialsChanged = true;
          await runtime.removeRuntimeApiKey(providerId);
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
          let supplied = false;
          await active.login(providerId, "api_key", {
            signal: AbortSignal.timeout(15000),
            notify: () => {},
            prompt: async (prompt) => {
              if (prompt.type !== "secret" || supplied)
                throw new AppError(
                  "AUTH_INTERACTION_REQUIRED",
                  "该供应商需要额外认证步骤，请使用单独登录流程。",
                );
              supplied = true;
              return key;
            },
          });
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
        await persisted.getAvailable(undefined, {
          signal: AbortSignal.timeout(5000),
        });
        if (persisted.getError()) throw Error();
        return { revision: digest(raw), loggedOut: [...logout] };
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
