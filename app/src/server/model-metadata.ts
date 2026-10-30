import { closeSync, constants, fstatSync, lstatSync, openSync, readFileSync, readSync } from "node:fs";
import { dirname, join } from "node:path";
import { accountBindings, selectedAuthPath } from "./model-account-storage.js";
import type { Credential, CredentialStore, ModelsStoreEntry } from "@earendil-works/pi-ai";
import { AppError } from "../shared/protocol.js";
import { costParts } from "../shared/costs.js";
import type { UsageModelPricing } from "../shared/provider-usage.js";

function readObject(path: string): Record<string, unknown> {
  try {
    const value = JSON.parse(readFileSync(path, "utf8").replace(/^\uFEFF/, ""));
    if (!value || typeof value !== "object" || Array.isArray(value)) throw Error();
    return value;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    // Parser errors can contain credentials. Never expose them to the client.
    throw new AppError("CONFIG_READ_FAILED", "本地模型或认证记录无法读取；原文件未修改。");
  }
}

/** A display snapshot, not request authentication. Never locks, creates or resolves auth.json. */
export function credentialMetadata(path: string, providerScope?: string): CredentialStore {
  const stored = readObject(path);
  for (const providerId of Object.keys(accountBindings(dirname(path)))) {
    if (providerScope && providerScope !== providerId) continue;
    const selected = readObject(selectedAuthPath(providerId, path));
    delete stored[providerId];
    if (Object.hasOwn(selected, providerId)) stored[providerId] = selected[providerId];
  }
  const data = providerScope ? Object.fromEntries(Object.entries(stored).filter(([id]) => id === providerScope)) : stored;
  for (const credential of Object.values(data)) {
    const value = credential as Partial<Credential> | null;
    if (!value || typeof value !== "object" || Array.isArray(value) ||
        !(value.type === "api_key" && (value.key === undefined || typeof value.key === "string") &&
          (value.env === undefined || !!value.env && typeof value.env === "object" && !Array.isArray(value.env) && Object.values(value.env).every(item => typeof item === "string")) ||
          value.type === "oauth" && typeof value.access === "string" && typeof value.refresh === "string" && typeof value.expires === "number" && Number.isFinite(value.expires)))
      throw new AppError("CONFIG_READ_FAILED", "本地认证记录格式无效；原文件未修改。");
  }
  const credentials = new Map(Object.entries(data) as [string, Credential][]);
  const readonly = async (): Promise<never> => { throw new Error("Model metadata is read-only"); };
  return {
    async read(providerId, options) {
      options?.signal?.throwIfAborted();
      const credential = credentials.get(providerId);
      return credential ? structuredClone(credential) : undefined;
    },
    async list(options) {
      options?.signal?.throwIfAborted();
      return [...credentials].map(([providerId, credential]) => ({ providerId, type: credential.type }));
    },
    modify: readonly,
    delete: readonly,
  };
}

/** Optional directory cache: invalid data must not hide the editable configuration. */
export function catalogMetadata(path: string): Record<string, ModelsStoreEntry> {
  try { return readObject(path) as Record<string, ModelsStoreEntry>; }
  catch { return {}; }
}

const record = (value: unknown): Record<string, unknown> | undefined => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
const own = (value: unknown, key: string) => { const object = record(value); return object && Object.hasOwn(object, key) ? object[key] : undefined; };
const displayName = (value: unknown) => typeof value === "string" && value.trim() && !/^axiom-(copy|model)-/.test(value.trim()) ? value.trim().slice(0, 160) : undefined;
/** Optional display data: bounded reads, no credential access, SDK initialization, migration or writes. */
function nameMetadata(path: string): Record<string, unknown> {
  let file: number | undefined;
  try {
    const pathStat = lstatSync(path);
    if (!pathStat.isFile() || pathStat.nlink !== 1) return {};
    file = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const before = fstatSync(file);
    if (!before.isFile() || before.nlink !== 1 || before.ino !== pathStat.ino || before.dev !== pathStat.dev || before.size > 4 * 1024 * 1024) return {};
    const bytes = Buffer.alloc(before.size + 1);
    let length = 0, count = 0;
    while (length < bytes.length && (count = readSync(file, bytes, length, bytes.length - length, null))) length += count;
    const after = fstatSync(file);
    if (length !== before.size || after.size !== before.size || after.nlink !== 1 || after.mtimeMs !== before.mtimeMs) return {};
    return record(JSON.parse(bytes.subarray(0, length).toString("utf8").replace(/^\uFEFF/, ""))) ?? {};
  } catch { return {}; }
  finally { if (file !== undefined) { try { closeSync(file); } catch { /* Optional display metadata must not hide accounting. */ } } }
}
/** Current local prices only: no SDK, credentials, remote catalog or history repricing. */
export function usageModelPricing(dir: string, providerId: string): UsageModelPricing[] {
  const configuration = nameMetadata(join(dir, "models.json")), catalog = nameMetadata(join(dir, "models-store.json"));
  const configured = own(configuration.providers, providerId), stored = record(own(catalog, providerId));
  const map = (value: unknown) => new Map(Array.isArray(value) ? value.slice(0, 1000).flatMap(item => {
    const row = record(item); return row && typeof row.id === "string" && row.id.length <= 160 ? [[row.id, row] as const] : [];
  }) : []);
  const custom = map(own(configured, "models")), cached = providerId === "kiro" || stored && Object.hasOwn(stored, "cacheScope") ? new Map<string, Record<string, unknown>>() : map(stored?.models);
  const overrides = record(own(configured, "modelOverrides")) ?? {};
  return [...new Set([...Object.keys(overrides), ...custom.keys(), ...cached.keys()])].slice(0, 1000).filter(id => id.length <= 160).map(model => {
    const candidates = [own(own(overrides, model), "cost"), custom.get(model)?.cost, cached.get(model)?.cost].map(record);
    const prices: UsageModelPricing["prices"] = {};
    for (const part of costParts) {
      const source = candidates.find(candidate => candidate && Object.hasOwn(candidate, part));
      const price = source?.[part];
      if (typeof price === "number" && Number.isFinite(price) && price >= 0) prices[part] = price;
    }
    return { model, prices, ...(candidates.some(value => Array.isArray(value?.tiers) && value!.tiers.length) ? { tiered: true } : {}) };
  });
}
/** Names never participate in accounting identity or the family cache, so renames remain visible. */
export function usageModelNames<T extends { provider: string | null; model: string | null }>(dir: string, rows: readonly T[]): (T & { name?: string })[] {
  if (!rows.length) return [];
  const configuration = nameMetadata(join(dir, "models.json")), catalog = nameMetadata(join(dir, "models-store.json"));
  const providers = new Map<string, { overrides: unknown; custom: Map<string, Record<string, unknown>>; cached: Map<string, Record<string, unknown>> }>();
  const index = (value: unknown) => {
    const result = new Map<string, Record<string, unknown>>();
    if (Array.isArray(value)) for (const item of value) { const model = record(item); if (model && typeof model.id === "string") result.set(model.id, model); }
    return result;
  };
  return rows.map((row, position) => {
    if (!row.provider || !row.model || position >= 1000) return { ...row };
    let provider = providers.get(row.provider);
    if (!provider) {
      const configured = own(configuration.providers, row.provider), stored = record(own(catalog, row.provider));
      provider = { overrides: own(configured, "modelOverrides"), custom: index(own(configured, "models")),
        // Scoped catalogs cannot be attributed without inspecting credentials; explicit names remain usable.
        cached: row.provider === "kiro" || stored && Object.hasOwn(stored, "cacheScope") ? new Map() : index(stored?.models) };
      providers.set(row.provider, provider);
    }
    const override = own(provider.overrides, row.model), custom = provider.custom.get(row.model);
    const name = displayName(own(override, "name")) ?? displayName(custom?.name) ?? displayName(provider.cached.get(row.model)?.name);
    return name ? { ...row, name } : { ...row };
  });
}
