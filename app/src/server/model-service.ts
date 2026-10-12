import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, open, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import {
  ModelRuntime,
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
import { AppError, object, text } from "../shared/protocol.js";
import {
  samplingKeys,
  type ModelConfiguration,
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
