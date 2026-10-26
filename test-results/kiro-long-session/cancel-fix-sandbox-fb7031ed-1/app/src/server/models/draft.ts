import { parseProviderProxy } from "../integrations/model-proxy-env.js";
import type { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { getSupportedThinkingLevels } from "@earendil-works/pi-ai";
import { AppError, object, text } from "../../shared/protocol.js";
import {
  modelApis,
  reasoningLevels,
  samplingKeys,
  assignModelConfigIds,
  bodyOverrideType,
  validBodyOverrideKey,
  editableBodyOverride,
  modelCostKeys,
  validModelPricing,
  type ReasoningLevel,
} from "../../shared/models.js";
type Json = Record<string, any>;
export const invalid = (message: string): never => {
  throw new AppError("INVALID_CONFIG", message);
};
// Add only configuration identities/field locations, never entered credentials or values.
function atConfig<T>(location: string, check: () => T): T {
  try {
    return check();
  } catch (error) {
    if (error instanceof AppError)
      throw new AppError(error.code, `${location} → ${error.message}`);
    throw error;
  }
}
function configLabel(kind: string, value: unknown, index: number): string {
  const item = value && typeof value === "object" ? value as Json : {};
  const name = typeof item.name === "string" ? item.name.trim().slice(0, 160) : "";
  const key = kind === "供应商" ? item.providerId : item.id;
  const identity = typeof key === "string" ? key.trim().slice(0, 160) : "";
  return `${kind}「${name || identity || `第 ${index + 1} 项`}」${identity && identity !== name ? `（${identity}）` : ""}`;
}
export function list(value: unknown, max: number): unknown[] {
  if (!Array.isArray(value) || value.length > max)
    return invalid("配置条目数量无效或超限");
  return value;
}
export function id(value: unknown, kind: string) {
  const result = text(value, kind, 160);
  if (
    ["__proto__", "prototype", "constructor"].includes(result) ||
    /[\x00-\x20\x7f]/.test(result)
  )
    invalid(`${kind} 含非法字符`);
  return result;
}
export function entries(provider: Json): Map<string, Json> {
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
            input: override.input ?? m.input,
            ...(m.cost || override.cost ? { cost: { ...m.cost, ...override.cost } } : {}),
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
export function levelsOf(
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
  for (const [index, row] of list(input, 100).entries()) {
    atConfig(`请求头覆盖第 ${index + 1} 行`, () => {
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
    });
  }
  return Object.fromEntries(result);
}
function bodyInput(input: unknown): Json {
  const result: [string, string | number][] = [],
    seen = new Set<string>();
  for (const [index, row] of list(input, 30).entries()) {
    atConfig(`请求体覆盖第 ${index + 1} 行`, () => {
      const r = object(row),
        key = text(r.key, "请求体字段", 100);
      if (seen.has(key)) invalid(`字段 ${key} 重复；请删除重复项`);
      if (!validBodyOverrideKey(key)) invalid("请求体字段名称无效");
      atConfig(`字段 ${key}`, () => {
        const valueType = r.valueType ?? bodyOverrideType(key);
        if (valueType !== "string" && valueType !== "number") invalid("请求体值类型无效");
        const inputValue = r.value;
        if (typeof inputValue !== "string" || inputValue.length > 8192)
          return invalid("请求体值必须为不超过 8192 字符的文本");
        if (valueType === "string") {
          seen.add(key);
          result.push([key, inputValue]);
          return;
        }
        if (!inputValue.trim()) invalid("请求体值必须为数值");
        const value = Number(inputValue);
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
      });
    });
  }
  return Object.fromEntries(result);
}

export function prepareDraft(draft: Json, config: Json, runtime: ModelRuntime) {
  const providers: Json = Object.create(null),
    originals = new Set<string>(),
    logout = new Set<string>();
  const keys = new Map<string, string>();
  for (const [index, value] of list(draft.providers, 100).entries()) {
    atConfig(configLabel("供应商", value, index), () => {
      const p = object(value),
        providerId = id(p.providerId, "供应商 ID");
      if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(providerId))
        invalid("供应商 ID 仅允许字母、数字、点、下划线和连字符");
      if (Object.hasOwn(providers, providerId)) invalid("供应商 ID 重复");
      const originalId =
        p.originalId === undefined ? undefined : id(p.originalId, "原供应商 ID");
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
      const oauth = p.connectionType === "oauth";
      if (oauth && !runtime.getProvider(providerId)?.auth.oauth?.login)
        invalid("该供应商不支持 OAuth 登录，请使用自定义接口");
      if (oauth && (p.key || p.clearKey))
        invalid("OAuth 连接不接受 API 密钥；退出登录请删除该供应商");
      next.name = text(p.name, "供应商名称", 80);
      next.axiomProxy = parseProviderProxy(p.proxy, original.axiomProxy);
      if (!oauth) {
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
            return invalid(
              "接口地址无效；请填写完整的 HTTP/HTTPS 地址，例如 https://api.example.com/v1",
            );
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
      // Normalize legacy/new drafts too; callers need these identities for validation after loading.
      const modelInputs = assignModelConfigIds(list(p.models, 1000).map((entry, modelIndex) =>
        atConfig(configLabel("模型", entry, modelIndex), () => {
          const m = object(entry);
          return { ...m, id: id(m.id, "模型 ID"),
            ...(m.configId === undefined ? {} : { configId: id(m.configId, "模型配置 ID") }) };
        }),
      ));
      p.models = modelInputs;
      next.models = [];
      next.modelOverrides = {};
      for (const [modelIndex, entry] of modelInputs.entries()) {
        atConfig(configLabel("模型", entry, modelIndex), () => {
          const m = object(entry),
            requestModelId = id(m.id, "模型 ID"),
            modelId = m.configId === undefined ? requestModelId : id(m.configId, "模型配置 ID");
          if (modelIds.has(modelId)) invalid("模型配置标识重复，请重新读取配置后重试");
          modelIds.add(modelId);
          const oldId =
            m.originalId === undefined ? undefined : id(m.originalId, "原模型 ID");
          if (oldId && (!previousModels.has(oldId) || modelOriginals.has(oldId)))
            invalid("原模型引用失效或重复");
          if (oldId) modelOriginals.add(oldId);
          const copyFromId = m.copyFromId === undefined ? undefined : id(m.copyFromId, "复制来源模型 ID");
          if (copyFromId && (oldId || !previousModels.has(copyFromId)))
            invalid("复制来源模型失效，请重新读取配置");
          const sourceId = oldId ?? copyFromId;
          const old = sourceId ? previousModels.get(sourceId)! : {};
          const body = bodyInput(m.body ?? []);
          const requestTarget = body.model ?? common.model ??
            (m.bodyVersion === 2 ? undefined : old.samplingParams?.model);
          // A user-created alias can name its upstream model in the request body.
          // Resolve within this provider; never infer a protocol from an unrelated first model.
          const source = runtime.getModel(providerId, sourceId ?? requestModelId);
          const target = oauth && typeof requestTarget === "string" ? runtime.getModel(providerId, requestTarget) : undefined;
          if (oauth && requestTarget !== undefined && !target)
            invalid("请求体 model：请指定该供应商目录中有效的原生模型 ID");
          // Existing configurations retain their transport. A cross-protocol body override
          // cannot safely change that transport; a fresh alias can inherit the target instead.
          if (source && target && source.api !== target.api)
            invalid("请求体 model：目标模型的接口协议与当前配置不同；请新建模型配置并填写目标模型 ID");
          const resolved = source ?? target;
          const native = !oauth && !sourceId && resolved?.api !== next.api ? undefined : resolved;
          const copySourceId = copyFromId ?? (native &&
            ((!oldId && modelId !== requestModelId) || (oauth && modelId !== native.id)) ? native.id : undefined);
          const model = structuredClone(old);
          if (copySourceId) {
            // Preserve arbitrary fields in both layers, including future Pi settings.
            Object.assign(model, structuredClone(original.modelOverrides?.[copySourceId] ?? {}));
            // Materialize effective native metadata as well as fields hidden from the editor.
            const effective = runtime.getModel(providerId, copySourceId);
            for (const key of ["api", "baseUrl", "reasoning", "thinkingLevelMap", "input", "inputLimits", "cost", "promptCache", "contextWindow", "maxTokens", "samplingParams", "samplingParamsByThinkingLevel", "compat"] as const) {
              // Automatically derived custom variants use the endpoint selected on this
              // provider. Explicit copies keep their source's model-level endpoint.
              if (key === "baseUrl" && !oauth && !copyFromId) continue;
              if (effective?.[key] !== undefined) model[key] = structuredClone(effective[key]);
            }
            if (!oauth && !copyFromId) delete model.baseUrl;
          }
          if (modelId !== requestModelId) model.axiomRequestModelId = requestModelId;
          else delete model.axiomRequestModelId;
          model.name = text(m.name || modelId, "模型名称", 160);
          model.headers = headersInput(
            m.headers,
            old.headers,
            draft.allowCommands === true,
          );
          if (copySourceId && (oauth || copyFromId)) {
            const nativeHeaders = runtime.getModel(providerId, copySourceId)?.headers ?? {};
            // Header names are case-insensitive; explicit configuration wins over native defaults.
            model.headers = Object.fromEntries(new Map(
              [...Object.entries(nativeHeaders), ...Object.entries(model.headers as Record<string, string>)]
                .map(([key, value]) => [key.toLowerCase(), [key, value]] as const),
            ).values());
          }
          const sampling = Object.fromEntries(
              Object.entries(model.samplingParams ?? {}).filter(
                ([key, val]) => m.bodyVersion === 2
                  ? !editableBodyOverride(key, val)
                  : !samplingKeys.includes(key as any) || typeof val !== "number",
              ),
            );
          model.samplingParams = { ...sampling, ...common, ...body };
          const api = model.api ?? (oauth ? native?.api : next.api);
          if (oauth && !api)
            invalid("接口协议：无法识别此模型的原生协议；请填写该供应商目录中的模型 ID，或在请求体 model 字段指定有效的原生模型 ID");
          if (
            Object.keys(model.samplingParams).length &&
            ![
              "openai-completions",
              "openai-responses",
              "azure-openai-responses",
            ].includes(api)
          )
            invalid(
              `请求体覆盖：接口协议 ${api} 不支持请求体覆盖；请移除供应商及该模型的请求体覆盖项，或选择支持的接口协议`,
            );
          const levels = list(m.levels, 7) as ReasoningLevel[];
          if (
            !levels.length ||
            new Set(levels).size !== levels.length ||
            levels.some((l) => !reasoningLevels.includes(l))
          )
            invalid("至少选择一个有效思考等级");
          // A newly imported endpoint model can share an ID with a native model
          // while using a different protocol. Save its own definition and capabilities.
          const existing = !oldId && !oauth && native?.api !== next.api ? undefined : native;
          if (m.cost !== undefined) {
            const pricing = m.cost;
            if (!validModelPricing(pricing)) return invalid("计费设置：四项单价必须为大于或等于 0 的有限数值（美元 / 百万 Token）");
            // Preserve catalog inheritance and existing tiers when base rates are unchanged.
            if (modelCostKeys.some(key => pricing[key] !== existing?.cost[key]))
              model.cost = { ...model.cost, ...Object.fromEntries(modelCostKeys.map(key => [key, pricing[key]])) };
          }
          if (m.input !== undefined) {
            if (!Array.isArray(m.input) || !m.input.includes("text") ||
                m.input.length > 2 || new Set(m.input).size !== m.input.length ||
                m.input.some((value: unknown) => value !== "text" && value !== "image"))
              invalid("输入能力：必须包含文本，可选图片；不支持其他输入类型或重复项");
            const input = ["text", ...((m.input as string[]).includes("image") ? ["image"] : [])];
            // Do not freeze native catalog metadata when the capability was not edited.
            const beforeInput = existing?.input ?? old.input ?? ["text"];
            if (input.length !== beforeInput.length || input.some((value) => !beforeInput.includes(value)) ||
                (!oldId && !existing) || (oldId && oldId !== modelId)) model.input = input;
          }
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
                  old.thinkingLevelMap?.[pi] ?? existing?.thinkingLevelMap?.[pi];
                return mapping != null
                  ? [[pi, mapping]]
                  : ["xhigh", "max"].includes(l)
                    ? [[pi, l]]
                    : [];
              }),
            );
          }
          const wasOverride = !copyFromId && modelId === requestModelId && (oldId
            ? Object.hasOwn(original.modelOverrides ?? {}, oldId) &&
              !(original.models ?? []).some((item: Json) => item.id === oldId)
            : !!existing && existing.id === modelId);
          if (wasOverride && (!oldId || oldId === modelId)) {
            if (
              !oauth && existing?.api !== next.api &&
              (!oldId ||
                next.api !==
                  (original.api ?? runtime.getModels(providerId)[0]?.api))
            )
              invalid(
                `接口协议：内置模型使用 ${existing?.api ?? "原生协议"}，不能覆盖为 ${next.api}；请恢复供应商接口协议`,
              );
            next.modelOverrides[modelId] = model;
          } else {
            model.id = modelId;
            // A renamed native override becomes a custom definition, whose default is text-only.
            if (oldId && oldId !== modelId) {
              if (model.input === undefined) model.input = [...(existing?.input ?? ["text"])];
              if (existing) model.cost = { ...existing.cost, ...model.cost };
            }
            if (existing && model.cost) model.cost = { ...existing.cost, ...model.cost };
            next.models.push(model);
            if (oldId && Object.hasOwn(original.modelOverrides ?? {}, oldId)) {
              const remaining = structuredClone(original.modelOverrides[oldId]);
              // The edited fields now live in the custom definition. Keep every other override.
              for (const key of [
                "name",
                "reasoning",
                "input",
                "cost",
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
        });
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
    });
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
      invalid(
        `供应商「${providerId}」→ API 密钥：退出登录与替换密钥不能同时执行；请先删除或退出，再单独登录`,
      );
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
  return { candidate, providers, logout, keys };
}
export function validateDraft(
  draft: Json,
  providers: Json,
  keys: Map<string, string>,
  checked: ModelRuntime,
) {
  for (const [providerId, p] of Object.entries(providers) as [string, Json][]) {
    atConfig(configLabel("供应商", { ...p, providerId }, 0), () => {
      for (const [modelId, model] of entries(p)) {
        atConfig(configLabel("模型", { ...model, id: modelId }, 0), () => {
          const actual = checked.getModel(providerId, modelId);
          if (!actual)
            return invalid(
              "模型 ID：该供应商加载后的模型列表中找不到此模型，相关设置无法生效。请核对供应商 ID 与模型 ID；如果这是自定义模型，请删除此失效配置后重新添加模型。",
            );
          if (
            Object.keys(model.samplingParams ?? {}).length &&
            ![
              "openai-completions",
              "openai-responses",
              "azure-openai-responses",
            ].includes(actual.api)
          )
            invalid(
              `请求体覆盖：模型实际接口协议 ${actual.api} 不支持请求体覆盖；请移除供应商及该模型的请求体覆盖项`,
            );
          const inputProvider = (draft.providers as Json[]).find(
            (v) => v.providerId.trim() === providerId,
          )!;
          const inputModel = inputProvider.models.find(
            (m: Json) => (m.configId ?? m.id).trim() === modelId,
          );
          if (inputModel.input !== undefined &&
              (actual.input.length !== inputModel.input.length ||
               actual.input.some((value) => !inputModel.input.includes(value))))
            invalid("输入能力：所选能力与模型加载后的能力不一致，请重新读取并调整模型配置");
          if (inputModel.cost !== undefined && modelCostKeys.some(key => actual.cost[key] !== inputModel.cost[key]))
            invalid("计费设置：所填单价与模型加载后的价格不一致，请重新读取并调整模型配置");
          const expected = inputModel.levels;
          if (
            levelsOf(actual).join() !==
            reasoningLevels.filter((l) => expected.includes(l)).join()
          )
            invalid(
              `思考等级：所选等级（${expected.join("、")}）与模型加载后的支持等级（${levelsOf(actual).join("、")}）不一致；请在模型配置中调整思考等级`,
            );
        });
      }
      if (
        keys.has(providerId) &&
        !checked.getProvider(providerId)?.auth.apiKey?.login
      )
        invalid("API 密钥：该供应商不支持 API Key 登录，请使用其认证流程");
    });
  }
}
