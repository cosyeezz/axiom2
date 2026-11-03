import { createHash, randomUUID } from "node:crypto";
import { closeSync, constants, fstatSync, lstatSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Credential, CredentialStore, ModelsStore } from "@earendil-works/pi-ai";
import { readStoredCredential } from "@earendil-works/pi-coding-agent";
import { AppError } from "../shared/protocol.js";

export type AccountRecord = { id: string; providerId: string; label: string; region: string; legacy?: boolean; createdAt: number };
export type AccountIndex = { version: 1; accounts: AccountRecord[]; active: Record<string, string> };
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const invalid = () => new AppError("ACCOUNT_STORAGE_INVALID", "账号记录无法读取或不安全；原文件未修改，请检查本地账号目录。");
function statIfPresent(path: string) {
  try { return lstatSync(path); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw invalid(); }
}
function safeDirectory(path: string) {
  const stat = statIfPresent(path);
  if (stat && (!stat.isDirectory() || stat.isSymbolicLink())) throw invalid();
  return stat;
}
export function safeAccountFile(file: string) {
  const stat = statIfPresent(file);
  if (stat && (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1)) throw invalid();
  return file;
}
export function accountsDirectory(dir: string) {
  const folder = join(dir, "model-accounts");
  safeDirectory(folder);
  return folder;
}
export function accountDirectory(dir: string, id: string) {
  if (!uuid.test(id)) throw new AppError("INVALID_INPUT", "账号 ID 无效。");
  const folder = join(accountsDirectory(dir), id);
  safeDirectory(folder);
  for (const file of ["auth.json", "models.json", "models-store.json"]) safeAccountFile(join(folder, file));
  return folder;
}
export function readAccountIndex(dir: string): AccountIndex {
  try {
    const folder = accountsDirectory(dir), file = join(folder, "index.json");
    const stat = statIfPresent(safeAccountFile(file));
    if (!stat) return { version: 1, accounts: [], active: {} };
    if (stat.size > 1024 * 1024) throw invalid();
    const fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW);
    let raw: string;
    try {
      const opened = fstatSync(fd);
      if (opened.ino !== stat.ino || opened.dev !== stat.dev || opened.nlink !== 1 || opened.size > 1024 * 1024) throw invalid();
      raw = readFileSync(fd, "utf8");
    } finally { closeSync(fd); }
    const value = JSON.parse(raw) as AccountIndex;
    if (value?.version !== 1 || !Array.isArray(value.accounts) || value.accounts.length > 500 || !value.active || typeof value.active !== "object" || Array.isArray(value.active)) throw invalid();
    const ids = new Set<string>();
    for (const row of value.accounts) {
      if (!row || !uuid.test(row.id) || ids.has(row.id) || typeof row.providerId !== "string" || !row.providerId || row.providerId.length > 160 ||
          typeof row.label !== "string" || row.label.length > 160 || typeof row.region !== "string" || row.region.length > 160 || !Number.isFinite(row.createdAt) ||
          row.legacy !== undefined && row.legacy !== true) throw invalid();
      ids.add(row.id);
    }
    for (const [provider, id] of Object.entries(value.active))
      if (!value.accounts.some(row => row.id === id && row.providerId === provider)) throw invalid();
    return value;
  } catch (error) {
    throw invalid();
  }
}
export function writeAccountIndex(dir: string, value: AccountIndex) {
  const folder = accountsDirectory(dir);
  mkdirSync(folder, { recursive: true, mode: 0o700 });
  if (lstatSync(folder).isSymbolicLink()) throw invalid();
  privateJson(join(folder, "index.json"), value);
}
export function privateJson(file: string, value: unknown) {
  safeDirectory(dirname(file));
  safeAccountFile(file);
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, JSON.stringify(value, null, 2) + "\n", { mode: 0o600, flag: "wx" });
    renameSync(temporary, file);
  } finally { rmSync(temporary, { force: true }); }
}

/** Captured once per execution environment/runtime, never re-selected during token rotation. */
export function accountBindings(dir: string): Record<string, string> {
  if (process.env.AXIOM_EXECUTION_PROFILE && process.env.AXIOM_MODEL_ACCOUNT_BINDINGS) {
    try {
      const value = JSON.parse(process.env.AXIOM_MODEL_ACCOUNT_BINDINGS);
      if (!value || typeof value !== "object" || Array.isArray(value) || Object.values(value).some(id => typeof id !== "string" || !uuid.test(id))) throw invalid();
      return value;
    } catch { throw invalid(); }
  }
  const index = readAccountIndex(dir);
  return Object.fromEntries(Object.entries(index.active).flatMap(([provider, id]) => {
    const account = index.accounts.find(row => row.id === id)!;
    return account.legacy ? [] : [[provider, account.id]];
  }));
}
export function selectedAuthPath(providerId: string, authPath: string, bindings = accountBindings(dirname(authPath))) {
  const id = Object.hasOwn(bindings, providerId) ? bindings[providerId] : undefined;
  return id ? join(accountDirectory(dirname(authPath), id), "auth.json") : authPath;
}
export function selectedCatalogPath(providerId: string, authPath: string, fallback: string, bindings = accountBindings(dirname(authPath))) {
  const id = Object.hasOwn(bindings, providerId) ? bindings[providerId] : undefined;
  return id ? join(accountDirectory(dirname(authPath), id), "models-store.json") : fallback;
}
/** Host/worker-internal identity guard. Never included in public account or usage DTOs. */
export const modelCredentialRevision = (credential: Credential | undefined) => credential?.type === "oauth"
  ? createHash("sha256").update(JSON.stringify(credential)).digest("hex") : undefined;
export function readModelCredential(providerId: string, authPath: string): Credential | undefined {
  return readStoredCredential(providerId, selectedAuthPath(providerId, authPath));
}
export const accountBindingRevision = (dir: string) => createHash("sha256").update(JSON.stringify(accountBindings(dir))).digest("hex");

// Pi 1.4.0 does not export its file stores at the package root. Keep this version-bound bridge in one place.
const piEntry = import.meta.resolve("@earendil-works/pi-coding-agent");
const authModule = import(new URL("./core/auth-storage.js", piEntry).href) as Promise<{ AuthStorage: { create(path: string): CredentialStore } }>;
const catalogModule = import(new URL("./core/models-store.js", piEntry).href) as Promise<{ FileModelsStore: new (path: string) => ModelsStore }>;
export async function accountRuntimeStores(authPath: string, catalogPath: string) {
  const bindings = accountBindings(dirname(authPath));
  if (!Object.keys(bindings).length) return undefined;
  const [{ AuthStorage }, { FileModelsStore }] = await Promise.all([authModule, catalogModule]);
  const auth = new Map<string, CredentialStore>(), catalogs = new Map<string, ModelsStore>();
  const credentialStore = (provider: string) => {
    const path = selectedAuthPath(provider, authPath, bindings);
    if (!auth.has(path)) auth.set(path, AuthStorage.create(path));
    return auth.get(path)!;
  };
  const catalogStore = (provider: string) => {
    const path = selectedCatalogPath(provider, authPath, catalogPath, bindings);
    if (!catalogs.has(path)) catalogs.set(path, new FileModelsStore(path));
    return catalogs.get(path)!;
  };
  const credentials: CredentialStore = {
    read: (provider, options) => credentialStore(provider).read(provider, options),
    modify: (provider, fn, options) => credentialStore(provider).modify(provider, fn, options),
    delete: (provider, options) => credentialStore(provider).delete(provider, options),
    async list(options) {
      const base = await credentialStore("").list(options);
      const rows = base.filter(row => !Object.hasOwn(bindings, row.providerId));
      for (const provider of Object.keys(bindings)) {
        const row = (await credentialStore(provider).list(options)).find(item => item.providerId === provider);
        if (row) rows.push(row);
      }
      return rows;
    },
  };
  const modelsStore: ModelsStore = {
    read: (provider, options) => catalogStore(provider).read(provider, options),
    write: (provider, entry, options) => catalogStore(provider).write(provider, entry, options),
    delete: (provider, options) => catalogStore(provider).delete(provider, options),
  };
  return { credentials, modelsStore };
}
