import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, open, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import {
  ModelRuntime,
  CredentialSynchronizationError,
} from "@earendil-works/pi-coding-agent";
import { getSupportedThinkingLevels } from "@earendil-works/pi-ai";
import { AppError, object, text } from "../shared/protocol.js";
import {
  modelApis,
  reasoningLevels,
  samplingKeys,
  type ModelConfiguration,
  type ProviderDraft,
  type OverrideRow,
  type ReasoningLevel,
} from "../shared/models.js";

// pi validates the full file. Only this editor's fields are changed; unrepresented fields stay on the server.
type Json = Record<string, any>;
const empty = '{"providers":{}}';
const digest = (raw: string) => createHash("sha256").update(raw).digest("hex");
const invalid = (message: string): never => {
  throw new AppError("INVALID_CONFIG", message);
};
function list(value: unknown, max: number): unknown[] {
  if (!Array.isArray(value) || value.length > max)
    return invalid("配置条目数量无效或超限");
  return value;
}
function id(value: unknown, kind: string) {
  const result = text(value, kind, 160);
  if (
    ["__proto__", "prototype", "constructor"].includes(result) ||
    /[\x00-\x20\x7f]/.test(result)
  )
    invalid(`${kind} 含非法字符`);
  return result;
}
function entries(provider: Json): Map<string, Json> {
  const models = new Map<string, Json>(
    Object.entries(provider.modelOverrides ?? {}),
  );
  for (const m of provider.models ?? []) {
    const override = provider.modelOverrides?.[m.id];
    models.set(
      m.id,
      override
        ? {
            ...m,
            name: override.name ?? m.name,
            reasoning: override.reasoning ?? m.reasoning,
            thinkingLevelMap: {
              ...m.thinkingLevelMap,
              ...override.thinkingLevelMap,
            },
            samplingParams: { ...m.samplingParams, ...override.samplingParams },
            // pi gives custom-model headers precedence over modelOverrides headers.
            headers: { ...override.headers, ...m.headers },
          }
        : m,
    );
  }
  return models;
}
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
function levelsOf(
  model: ReturnType<ModelRuntime["getModel"]>,
): ReasoningLevel[] {
  return model
    ? getSupportedThinkingLevels(model).map((l) => (l === "off" ? "none" : l))
    : ["none"];
}
function headersInput(
  input: unknown,
  previous: Json = {},
  allowCommands: boolean,
): Json {
  const result: [string, string][] = [],
    names = new Set<string>();
  for (const row of list(input, 100)) {
    const r = object(row),
      key = text(r.key, "请求头名称", 160);
    if (!/^[!#$%&'*+.^_`|~\w-]+$/.test(key) || names.has(key.toLowerCase()))
      invalid("请求头名称无效或重复（不区分大小写）");
    names.add(key.toLowerCase());
    let value: string;
    if (r.keep === true) {
      if (r.source !== key || !Object.hasOwn(previous, key))
        invalid("已保存请求头引用失效，请重新读取");
      value = previous[key];
    } else {
      if (
        typeof r.value !== "string" ||
        r.value.length > 8192 ||
        /[\r\n\0]/.test(r.value)
      )
        invalid("请求头值无效");
      value = r.value as string;
      if (value.startsWith("!") && !allowCommands)
        throw new AppError(
          "COMMAND_AUTHORIZATION_REQUIRED",
          "请求头包含可执行命令；需要明确授权后才能保存。",
        );
      if (/^[*•●]+$/.test(value)) invalid("掩码不能作为请求头值保存");
    }
    result.push([key, value]);
  }
  return Object.fromEntries(result);
}
function bodyInput(input: unknown): Json {
  const result: [string, number][] = [],
    seen = new Set<string>();
  for (const row of list(input, 30)) {
    const r = object(row),
      key = text(r.key, "请求体字段", 100);
    if (!samplingKeys.includes(key as any) || seen.has(key))
      invalid("请求体字段不支持或重复；仅允许列出的数值采样参数");
    if (typeof r.value !== "string" || !r.value.trim())
      invalid("请求体值必须为数值");
    const value = Number(r.value);
    if (!Number.isFinite(value)) invalid("请求体值必须为有限数值");
    if (["top_p", "min_p"].includes(key) && (value < 0 || value > 1))
      invalid("top_p / min_p 必须在 0–1 之间");
    if (key === "temperature" && (value < 0 || value > 2))
      invalid("temperature 必须在 0–2 之间");
    if (
      ["presence_penalty", "frequency_penalty"].includes(key) &&
      Math.abs(value) > 2
    )
      invalid("惩罚参数必须在 -2–2 之间");
    if (
      [
        "seed",
        "top_k",
        "max_tokens",
        "max_completion_tokens",
        "max_output_tokens",
      ].includes(key) &&
      (!Number.isSafeInteger(value) || (key !== "seed" && value < 0))
    )
      invalid("该采样参数必须为有效整数");
    seen.add(key);
    result.push([key, value]);
  }
  return Object.fromEntries(result);
}

export class ModelService {
  readonly dir: string;
  private tail: Promise<unknown> = Promise.resolve();
  authActive = false;
  beforeLogout?: (providers: string[], confirmed: boolean) => Promise<void>;
  constructor(readonly root: string) {
    this.dir = join(root, "pi");
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
          headers: headersView(m.headers),
          body: bodyView(m.samplingParams),
        })),
      });
    }
    return {
      revision,
      providers,
      templates: runtime.getProviders().map((p) => ({
        id: p.id,
        name: p.name,
        api: p.getModels()[0]?.api ?? "openai-completions",
        url: urlView(p.baseUrl ?? p.getModels()[0]?.baseUrl ?? "").url,
      })),
    };
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
      const providers: Json = Object.create(null),
        originals = new Set<string>(),
        logout = new Set<string>();
      const keys = new Map<string, string>();
      for (const value of list(draft.providers, 100)) {
        const p = object(value),
          providerId = id(p.providerId, "供应商 ID");
        if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(providerId))
          invalid("供应商 ID 仅允许字母、数字、点、下划线和连字符");
        if (Object.hasOwn(providers, providerId)) invalid("供应商 ID 重复");
        const originalId =
          p.originalId === undefined
            ? undefined
            : id(p.originalId, "原供应商 ID");
        if (
          originalId &&
          (originals.has(originalId) ||
            !Object.hasOwn(config.providers, originalId) ||
            originalId !== providerId)
        )
          invalid("已有供应商 ID 不可修改或重复");
        if (!originalId && Object.hasOwn(config.providers, providerId))
          invalid("供应商已存在，请重新读取后编辑");
        if (originalId) originals.add(originalId);
        const original: Json = originalId ? config.providers[originalId] : {};
        const next = structuredClone(original);
        next.name = text(p.name, "供应商名称", 80);
        next.api = text(p.api, "接口协议", 100);
        if (
          !modelApis.includes(next.api) &&
          next.api !== original.api &&
          next.api !== runtime.getModels(providerId)[0]?.api
        )
          invalid("当前接口协议不支持编辑");
        if (p.keepUrl === true) {
          if (!original.baseUrl) invalid("已保存地址引用失效");
        } else {
          const endpoint = text(p.url, "接口地址", 2048);
          let url: URL;
          try {
            url = new URL(endpoint);
          } catch {
            return invalid("接口地址无效");
          }
          if (
            !["http:", "https:"].includes(url.protocol) ||
            url.username ||
            url.password ||
            url.search ||
            url.hash
          )
            invalid("接口地址仅允许 HTTP/HTTPS，不允许凭据、查询参数或片段");
          next.baseUrl = endpoint;
        }
        next.headers = headersInput(
          p.headers,
          original.headers,
          draft.allowCommands === true,
        );
        const common = bodyInput(p.body ?? []),
          previousModels = entries(original),
          modelIds = new Set<string>(),
          modelOriginals = new Set<string>();
        next.models = [];
        next.modelOverrides = {};
        for (const entry of list(p.models, 1000)) {
          const m = object(entry),
            modelId = id(m.id, "模型 ID");
          if (modelIds.has(modelId)) invalid("同一供应商的模型 ID 重复");
          modelIds.add(modelId);
          const oldId =
            m.originalId === undefined
              ? undefined
              : id(m.originalId, "原模型 ID");
          if (
            oldId &&
            (!previousModels.has(oldId) || modelOriginals.has(oldId))
          )
            invalid("原模型引用失效或重复");
          if (oldId) modelOriginals.add(oldId);
          const old = oldId ? previousModels.get(oldId)! : {},
            model = structuredClone(old);
          model.name = text(m.name || modelId, "模型名称", 160);
          model.headers = headersInput(
            m.headers,
            old.headers,
            draft.allowCommands === true,
          );
          const body = bodyInput(m.body ?? []),
            sampling = Object.fromEntries(
              Object.entries(old.samplingParams ?? {}).filter(
                ([key, val]) =>
                  !samplingKeys.includes(key as any) || typeof val !== "number",
              ),
            );
          model.samplingParams = { ...sampling, ...common, ...body };
          const api = model.api ?? next.api;
          if (
            Object.keys(model.samplingParams).length &&
            ![
              "openai-completions",
              "openai-responses",
              "azure-openai-responses",
            ].includes(api)
          )
            invalid("当前协议不支持请求体采样覆盖，不能保存后忽略");
          const levels = list(m.levels, 7) as ReasoningLevel[];
          if (
            !levels.length ||
            new Set(levels).size !== levels.length ||
            levels.some((l) => !reasoningLevels.includes(l))
          )
            invalid("至少选择一个有效思考等级");
          const existing = runtime.getModel(providerId, oldId ?? modelId);
          if (
            existing?.reasoning &&
            !getSupportedThinkingLevels(existing).includes("off") &&
            levels.includes("none")
          )
            invalid("该模型不支持关闭思考，不能选择 none");
          const beforeLevels = levelsOf(oldId ? existing : undefined);
          if (levels.join() !== beforeLevels.join() || !oldId) {
            model.reasoning = levels.some((l) => l !== "none");
            model.thinkingLevelMap = Object.fromEntries(
              reasoningLevels.flatMap((l) => {
                const pi = l === "none" ? "off" : l;
                if (!levels.includes(l)) return [[pi, null]];
                // Preserve provider mappings. Standard levels use pi defaults; extended levels opt in explicitly.
                const mapping =
                  old.thinkingLevelMap?.[pi] ??
                  existing?.thinkingLevelMap?.[pi];
                return mapping != null
                  ? [[pi, mapping]]
                  : ["xhigh", "max"].includes(l)
                    ? [[pi, l]]
                    : [];
              }),
            );
          }
          const wasOverride = oldId
            ? Object.hasOwn(original.modelOverrides ?? {}, oldId) &&
              !(original.models ?? []).some((item: Json) => item.id === oldId)
            : !!existing;
          if (wasOverride && (!oldId || oldId === modelId)) {
            if (
              existing?.api !== next.api &&
              (!oldId ||
                next.api !==
                  (original.api ?? runtime.getModels(providerId)[0]?.api))
            )
              invalid(
                "内置模型使用其原生协议；不能通过供应商协议覆盖后静默忽略",
              );
            next.modelOverrides[modelId] = model;
          } else {
            model.id = modelId;
            next.models.push(model);
            if (oldId && Object.hasOwn(original.modelOverrides ?? {}, oldId)) {
              const remaining = structuredClone(original.modelOverrides[oldId]);
              // The edited fields now live in the custom definition. Keep every other override.
              for (const key of [
                "name",
                "reasoning",
                "thinkingLevelMap",
                "samplingParams",
                "headers",
              ])
                delete remaining[key];
              if (Object.keys(remaining).length)
                next.modelOverrides[modelId] = remaining;
            }
          }
          if (oldId && oldId !== modelId) logout.add(providerId);
        }
        if ([...previousModels.keys()].some((m) => !modelIds.has(m)))
          logout.add(providerId);
        if (
          typeof p.key !== "string" ||
          p.key.length > 8192 ||
          /[\r\n\0]/.test(p.key)
        )
          invalid("API 密钥无效");
        const key = (p.key as string).trim();
        if (key) {
          if (key.startsWith("!") && draft.allowCommands !== true)
            throw new AppError(
              "COMMAND_AUTHORIZATION_REQUIRED",
              "API 密钥包含可执行命令；需要明确授权后才能保存。",
            );
          if (/^[*•●]+$/.test(key)) invalid("掩码不能作为新密钥保存");
          keys.set(providerId, key);
          delete next.apiKey;
        }
        if (p.clearKey === true) logout.add(providerId);
        if (Object.keys(common).length && !modelIds.size)
          invalid("供应商请求体项需要至少一个模型才能生效");
        providers[providerId] = next;
      }
      for (const providerId of Object.keys(config.providers))
        if (!originals.has(providerId)) logout.add(providerId);
      if (logout.size && draft.confirmLogout !== true)
        throw new AppError(
          "LOGOUT_CONFIRMATION_REQUIRED",
          "删除或清除认证会退出整个供应商，同供应商其他模型也可能需要重新认证；请确认影响。",
        );
      for (const providerId of logout) {
        if (keys.has(providerId))
          invalid("退出登录与替换密钥不能同时执行；请先删除或退出，再单独登录");
        const p = providers[providerId];
        if (p) {
          delete p.apiKey;
          for (const item of [
            p,
            ...(p.models ?? []),
            ...Object.values(p.modelOverrides ?? {}),
          ] as Json[]) {
            item.headers = {};
            if (item.baseUrl) {
              const url = new URL(item.baseUrl);
              url.username = "";
              url.password = "";
              url.search = "";
              url.hash = "";
              item.baseUrl = url.toString();
            }
          }
        }
      }
      const candidate = { ...config, providers };
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
        for (const [providerId, p] of Object.entries(providers) as [
          string,
          Json,
        ][]) {
          for (const modelId of entries(p).keys()) {
            const actual = checked.getModel(providerId, modelId);
            if (!actual) return invalid("模型覆盖目标不存在，不能保存后忽略");
            if (
              Object.keys(entries(p).get(modelId)!.samplingParams ?? {})
                .length &&
              ![
                "openai-completions",
                "openai-responses",
                "azure-openai-responses",
              ].includes(actual.api)
            )
              invalid("模型实际协议不支持请求体采样覆盖，不能保存后忽略");
            const inputProvider = (draft.providers as Json[]).find(
              (v) => v.providerId.trim() === providerId,
            )!;
            const expected = inputProvider.models.find(
              (m: Json) => m.id.trim() === modelId,
            ).levels;
            if (
              levelsOf(actual).join() !==
              reasoningLevels.filter((l) => expected.includes(l)).join()
            )
              invalid("思考等级与 pi 模型能力不匹配，不能保存后忽略");
          }
          if (
            keys.has(providerId) &&
            !checked.getProvider(providerId)?.auth.apiKey?.login
          )
            invalid("该供应商不支持 API Key 登录，请使用其认证流程");
        }
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
        await active.getAvailable(undefined, {
          signal: AbortSignal.timeout(5000),
        });
        if (active.getError()) throw Error();
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
