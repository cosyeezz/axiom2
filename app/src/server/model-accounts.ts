import { createHash, randomUUID } from "node:crypto";
import { lstatSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { readStoredCredential } from "@earendil-works/pi-coding-agent";
import type { Credential } from "@earendil-works/pi-ai";
import { AppError, object, text } from "../shared/protocol.js";
import type { AddModelAccount, ModelAccounts } from "../shared/model-accounts.js";
import type { SessionAccountTarget, SessionAccountUsage } from "../shared/session-account-usage.js";
import { accountDirectory, privateJson, readAccountIndex, writeAccountIndex, modelCredentialRevision, type AccountIndex, type AccountRecord } from "./model-account-storage.js";
import type { ModelService } from "./model-service.js";
import { modelNetwork } from "./model-network.js";
import { ProviderUsageService } from "./provider-usage.js";
import { accountInfo } from "./model-account-info.js";

const revisionOf = (index: AccountIndex) => createHash("sha256").update(JSON.stringify(index)).digest("hex");
const credentialText = (credential: Credential | undefined, field: string) => {
  const value = (credential as unknown as Record<string, unknown> | undefined)?.[field];
  return typeof value === "string" && value.length <= 160 && !/[\x00-\x1f]/.test(value) ? value : "";
};
export class ModelAccountService {
  private usageServices = new Map<string, ProviderUsageService>();
  constructor(private models: ModelService, private network = modelNetwork) {}
  private importLegacy(index: AccountIndex) {
    let stored: Record<string, Credential>;
    try { stored = object(JSON.parse(readFileSync(join(this.models.dir, "auth.json"), "utf8").replace(/^\uFEFF/, ""))) as Record<string, Credential>; }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
      throw new AppError("CONFIG_READ_FAILED", "无法读取已有认证，未修改账号记录。");
    }
    let changed = false;
    for (const [providerId, credential] of Object.entries(stored)) {
      if (!["oauth", "api_key"].includes(credential?.type) || index.accounts.some(row => row.legacy && row.providerId === providerId)) continue;
      if (index.accounts.length >= 500) throw new AppError("ACCOUNT_LIMIT", "账号最多保存 500 条。");
      index.accounts.push({ id: randomUUID(), providerId, label: "原有账号", region: "", legacy: true, createdAt: Date.now() });
      changed = true;
    }
    return changed;
  }
  private index() {
    const index = readAccountIndex(this.models.dir);
    if (this.importLegacy(index)) writeAccountIndex(this.models.dir, index);
    return index;
  }
  private account(index: AccountIndex, id: unknown) {
    const row = index.accounts.find(row => row.id === id);
    if (!row) throw new AppError("NOT_FOUND", "账号不存在，请刷新账号列表。");
    return row;
  }
  private dir(row: AccountRecord) { return row.legacy ? this.models.dir : accountDirectory(this.models.dir, row.id); }
  private credential(row: AccountRecord) { return readStoredCredential(row.providerId, join(this.dir(row), "auth.json")); }
  private snapshot(index: AccountIndex): ModelAccounts {
    return { revision: revisionOf(index), accounts: index.accounts.map(row => {
      const credential = this.credential(row);
      const activeId = (Object.hasOwn(index.active, row.providerId) ? index.active[row.providerId] : undefined) ?? index.accounts.find(item => item.providerId === row.providerId && item.legacy)?.id;
      return { id: row.id, providerId: row.providerId, label: row.label, region: row.region || credentialText(credential, "region"),
        legacy: !!row.legacy, active: activeId === row.id, createdAt: row.createdAt, ...accountInfo(row.providerId, credential),
        ...(credential ? { type: credential.type } : {}),
        ...(credential?.type === "oauth" && Number.isFinite(credential.expires) && credential.expires > 0 && credential.expires <= 8.64e15 ? { expiresAt: credential.expires } : {}) };
    }) };
  }
  list() { return this.models.serial(async () => this.snapshot(this.index())); }
  async activate(id: unknown, revision: unknown) {
    return this.models.serial(async () => {
      if (this.models.authActive) throw new AppError("AUTH_BUSY", "请先完成或取消正在进行的认证。");
      const index = this.index(), row = this.account(index, id);
      if (revision !== revisionOf(index)) throw new AppError("REVISION_CONFLICT", "账号列表已改变，请刷新后再切换。");
      if (!this.credential(row)) throw new AppError("ACCOUNT_AUTH_MISSING", "此账号没有可用认证，请重新登录。");
      index.active = { ...index.active, [row.providerId]: row.id };
      // Selection is a single atomic pointer update. No token copies or refresh-token mirroring.
      writeAccountIndex(this.models.dir, index);
      return this.snapshot(index);
    });
  }
  prepare(providerId: string, input: unknown) {
    const draft = object(input), label = text(draft.label, "账号名称", 160);
    const region = draft.region === undefined || draft.region === "" ? "" : text(draft.region, "账号区域", 160);
    const id = randomUUID(), dir = accountDirectory(this.models.dir, id);
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    if (lstatSync(dir).isSymbolicLink()) throw new AppError("ACCOUNT_STORAGE_INVALID", "账号目录不安全。");
    return { id, dir, draft: { label, region } satisfies AddModelAccount, providerId };
  }
  async configure(staged: ReturnType<ModelAccountService["prepare"]>) {
    const config = JSON.parse(await this.models.raw());
    // Network policy is inherited from the model connection, not from another account's credentials.
    privateJson(join(staged.dir, "models.json"), { providers: Object.hasOwn(config.providers, staged.providerId) ? { [staged.providerId]: config.providers[staged.providerId] } : {} });
  }
  async commit(staged: ReturnType<ModelAccountService["prepare"]>, type: "oauth" | "api_key", selectIfFirst = false) {
    return this.models.serial(async () => {
      const credential = readStoredCredential(staged.providerId, join(accountDirectory(this.models.dir, staged.id), "auth.json"));
      if (credential?.type !== type) throw new AppError("ACCOUNT_AUTH_MISSING", "未能确认账号认证已保存，原账号未改变。");
      const index = this.index();
      if (index.accounts.some(row => row.id === staged.id)) return;
      // There is nothing to switch away from for a brand-new supplier. Make its first
      // successful login usable even though single-account cards are intentionally hidden.
      if (selectIfFirst && !index.accounts.some(row => row.providerId === staged.providerId) && !Object.hasOwn(index.active, staged.providerId))
        index.active = { ...index.active, [staged.providerId]: staged.id };
      index.accounts.push({ id: staged.id, providerId: staged.providerId, label: staged.draft.label, region: staged.draft.region ?? "", createdAt: Date.now() });
      if (index.accounts.length > 500) throw new AppError("ACCOUNT_LIMIT", "账号最多保存 500 条。");
      writeAccountIndex(this.models.dir, index);
    });
  }
  async recover(staged: ReturnType<ModelAccountService["prepare"]>, type: "oauth" | "api_key") {
    if (readStoredCredential(staged.providerId, join(accountDirectory(this.models.dir, staged.id), "auth.json"))?.type !== type) return false;
    await this.commit(staged, type);
    return true;
  }
  discard(staged: ReturnType<ModelAccountService["prepare"]>) {
    if (readAccountIndex(this.models.dir).accounts.some(row => row.id === staged.id)) return;
    const dir = accountDirectory(this.models.dir, staged.id);
    // A cancelled IPC response or a catalog-sync error does not undo a credential commit.
    // Never delete credentials just because the corresponding card was not registered yet.
    if (readStoredCredential(staged.providerId, join(dir, "auth.json")))
      throw new AppError("ACCOUNT_RECOVERY_REQUIRED", "认证已经写入，未登记的账号目录已保留以便恢复。");
    rmSync(dir, { recursive: true, force: true });
  }
  /** A scope-owned binding, not a client-selected account. Never imports legacy metadata or writes an index. */
  cachedBinding(target: SessionAccountTarget): SessionAccountUsage | null {
    try {
      // A stored credential cannot prove identity when model config overrides the native auth or endpoint.
      const readConfiguration = () => {
        try { return readFileSync(join(this.models.dir, "models.json"), "utf8"); }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
      };
      const raw = readConfiguration(), config = JSON.parse((raw ?? "{}").replace(/^\uFEFF/, ""));
      const provider = config.providers?.[target.providerId] ?? {};
      const overridesAuth = (value: Record<string, unknown>) => ["apiKey", "oauth", "authHeader", "api", "baseUrl"].some(key => value[key] !== undefined)
        || value.headers !== undefined && Object.keys(object(value.headers)).length > 0;
      if (overridesAuth(provider) || [...(provider.models ?? []), ...Object.values(provider.modelOverrides ?? {})].some(value => overridesAuth(object(value)))) return null;
      const index = readAccountIndex(this.models.dir);
      const id = target.accountId === undefined ? index.active[target.providerId] : target.accountId;
      const row = id ? index.accounts.find(row => row.id === id && row.providerId === target.providerId)
        : index.accounts.find(row => row.providerId === target.providerId && row.legacy);
      if (id && !row || typeof target.accountId === "string" && row?.legacy) return null;
      const dir = row ? this.dir(row) : this.models.dir;
      const credential = row ? this.credential(row) : readStoredCredential(target.providerId, join(dir, "auth.json"));
      const credentialKey = modelCredentialRevision(credential);
      if (!credentialKey || target.source === "execution" && target.credentialKey !== credentialKey) return null;
      // Both the actual cache snapshot and its final recheck must match this
      // credential/configuration, even if another process overwrites a slot.
      const fallback = () => new ProviderUsageService(this.models.root, dir, async () => { throw Error("Cache-only probe cannot query"); },
        join(this.models.dir, "models.json"), true, { cacheDir: this.models.dir }).peekCached(target.providerId, credentialKey, raw ?? "missing");
      const usage = (row ? this.usageService(row).peekCached(target.providerId, credentialKey, raw ?? "missing") : undefined) ?? fallback();
      if (!usage || readConfiguration() !== raw || modelCredentialRevision(readStoredCredential(target.providerId, join(dir, "auth.json"))) !== credentialKey) return null;
      if (target.source === "next-execution") {
        const current = readAccountIndex(this.models.dir);
        const defaultId = current.active[target.providerId] ?? current.accounts.find(item => item.providerId === target.providerId && item.legacy)?.id;
        if (defaultId !== row?.id) return null;
      }
      const info = accountInfo(target.providerId, credential);
      return { identity: `${target.identity}:${row?.id ?? "legacy"}`, providerId: target.providerId, source: target.source,
        account: { ...(row ? { id: row.id } : {}), label: row?.label || "原有账号", ...(info.email ? { email: info.email } : {}), ...(info.plan ? { plan: info.plan } : {}) }, usage };
    } catch { return null; }
  }
  private usageService(row: AccountRecord) {
    const dir = this.dir(row);
    let service = this.usageServices.get(row.id);
    if (!service) {
      // Legacy-card queries must not follow the active pointer. It represents the original auth.json.
      const credentialDir = row.legacy ? this.models.dir : dir;
      const path = join(this.models.dir, "models.json");
      service = new ProviderUsageService(this.models.root, credentialDir,
        (provider, cancellation) => this.network(this.models.root, credentialDir, provider, path, "usage", { accountDirect: true }, { signal: cancellation }), path,
        true, { cacheDir: accountDirectory(this.models.dir, row.id), minimum: 60_000, jitter: 10_000 });
      this.usageServices.set(row.id, service);
    }
    return service;
  }
  async usage(id: unknown, refresh: boolean, signal?: AbortSignal, preferCache = false) {
    const row = this.account(readAccountIndex(this.models.dir), id);
    return this.usageService(row).read(row.providerId, refresh, signal, preferCache);
  }
}
