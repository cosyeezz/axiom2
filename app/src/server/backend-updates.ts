import type { DatabaseSync } from "node:sqlite";
import { readFile } from "node:fs/promises";
import { AppError } from "../shared/protocol.js";
import { newerBackendVersion, stableVersion, type BackendUpdateReply, type BackendUpdateState } from "../shared/backend-updates.js";

const api = "https://api.github.com/repos/cosyeezz/axiom2/releases/latest";
const downloadBase = "https://github.com/cosyeezz/axiom2/releases/download/";
async function releaseBody(response: Response) {
  const reader = response.body?.getReader();
  if (!reader) throw Error("发布信息为空");
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 2_000_000) { await reader.cancel(); throw Error("发布信息超过大小上限"); }
      chunks.push(value);
    }
    return Buffer.concat(chunks).toString("utf8");
  } finally { reader.releaseLock(); }
}
export async function runningBackendVersion(): Promise<string | null> {
  // Both src/server and dist/server have the same depth. Read OUR package once,
  // never installation.json (which can point at a different global installation).
  try { const pkg = JSON.parse(await readFile(new URL("../../../package.json", import.meta.url), "utf8")); return stableVersion(pkg.version) ? pkg.version : null; }
  catch { return null; }
}
export type BackendUpdateOptions = { fetcher?: typeof fetch; version?: string | null; intervalMs?: number; initialDelayMs?: number; now?: () => number };
export class BackendUpdates {
  private latest: BackendUpdateState["latest"] = null;
  private checkedAt: number | null = null;
  private etag: string | null = null;
  private error: string | null = null;
  private pendingCheck?: Promise<BackendUpdateState>;
  private timer?: ReturnType<typeof setTimeout>;
  private abort?: AbortController;
  private closed = false;
  private readonly now: () => number;
  private readonly fetcher: typeof fetch;
  constructor(private db: DatabaseSync, private version: string | null, private publish: () => void, private options: BackendUpdateOptions = {}) {
    this.now = options.now ?? Date.now; this.fetcher = options.fetcher ?? fetch;
    db.exec(`CREATE TABLE IF NOT EXISTS backend_update_cache(id INTEGER PRIMARY KEY CHECK(id=1),body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS backend_update_notices(version TEXT PRIMARY KEY,shownAt INTEGER NOT NULL,dismissedAt INTEGER);`);
    try {
      const row = db.prepare("SELECT body FROM backend_update_cache WHERE id=1").get();
      const saved = row && JSON.parse(String(row.body));
      if (stableVersion(saved?.latest?.version) && saved.latest.url === `https://github.com/cosyeezz/axiom2/releases/tag/v${saved.latest.version}` && Number.isFinite(saved.checkedAt)) {
        this.latest = saved.latest; this.checkedAt = saved.checkedAt; this.etag = typeof saved.etag === "string" ? saved.etag : null;
      }
    } catch { /* Optional metadata cache is replaceable; notice receipts are not. */ }
  }
  start() {
    if (this.closed || this.timer) return;
    const tick = async () => { this.timer = undefined; await this.check(); if (!this.closed) { this.timer = setTimeout(tick, this.options.intervalMs ?? 30 * 60_000); this.timer.unref(); } };
    this.timer = setTimeout(tick, this.options.initialDelayMs ?? 30_000); this.timer.unref();
  }
  snapshot(): BackendUpdateState {
    const available = !!this.latest && !!this.version && newerBackendVersion(this.latest.version, this.version);
    const fresh = this.checkedAt !== null && this.now() >= this.checkedAt && this.now() - this.checkedAt < (this.options.intervalMs ?? 30 * 60_000) * 2;
    const shown = this.latest && this.db.prepare("SELECT 1 FROM backend_update_notices WHERE version=?").get(this.latest.version);
    return { runningVersion: this.version, latest: this.latest, checkedAt: this.checkedAt, checking: !!this.pendingCheck, available, pending: available && fresh && !this.error && !shown, error: this.error };
  }
  private save() {
    this.db.prepare("INSERT INTO backend_update_cache VALUES(1,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body").run(JSON.stringify({ latest: this.latest, checkedAt: this.checkedAt, etag: this.etag }));
  }
  check(): Promise<BackendUpdateState> {
    if (this.closed) return Promise.reject(new AppError("CLOSED", "版本检查器已关闭"));
    if (this.pendingCheck) return this.pendingCheck;
    this.abort = new AbortController();
    this.pendingCheck = this.fetchLatest(this.abort.signal).finally(() => { this.pendingCheck = undefined; if (!this.closed) this.publish(); });
    this.publish();
    return this.pendingCheck;
  }
  private async fetchLatest(signal: AbortSignal): Promise<BackendUpdateState> {
    try {
      const response = await this.fetcher(api, { headers: { Accept: "application/vnd.github+json", ...(this.etag && this.latest ? { "If-None-Match": this.etag } : {}) }, signal: AbortSignal.any([signal, AbortSignal.timeout(10_000)]) });
      if (signal.aborted || this.closed) throw Error("版本检查已取消");
      if (response.status !== 304 || !this.latest) {
        if (!response.ok) throw Error(`版本检查失败（HTTP ${response.status}）`);
        const text = await releaseBody(response);
        const release = JSON.parse(text), version = String(release.tag_name ?? "").replace(/^v/, "");
        if (!stableVersion(version) || release.tag_name !== `v${version}` || release.draft || release.prerelease || !Array.isArray(release.assets)) throw Error("未取得正式后台版本");
        const assets = release.assets.filter((asset: { name?: string }) => asset.name === "axiom2.tgz");
        const asset = assets[0];
        if (assets.length !== 1 || asset.browser_download_url !== `${downloadBase}v${version}/axiom2.tgz` || !Number.isSafeInteger(asset.size) || asset.size < 1 || !/^sha256:[a-f0-9]{64}$/.test(asset.digest)) throw Error("后台发布附件信息无效");
        if (this.latest && newerBackendVersion(this.latest.version, version)) throw Error("发布版本回退，未替换已核实的更新目标");
        this.latest = { version, url: `https://github.com/cosyeezz/axiom2/releases/tag/v${version}` };
        this.etag = response.headers.get("etag");
      }
      if (signal.aborted || this.closed) throw Error("版本检查已取消");
      this.checkedAt = this.now(); this.error = null; this.save();
    } catch (error) { if (!this.closed) this.error = error instanceof Error ? error.message : "版本检查失败"; }
    return this.closed ? { runningVersion: this.version, latest: null, checkedAt: null, checking: false, available: false, pending: false, error: null } : { ...this.snapshot(), checking: false };
  }
  async command(action: string, version?: unknown): Promise<BackendUpdateReply> {
    if (this.closed) throw new AppError("CLOSED", "版本检查器已关闭");
    if (action === "check") return this.check();
    if (action === "get") return this.snapshot();
    if (!["present", "dismiss"].includes(action) || !stableVersion(version)) throw new AppError("INVALID_COMMAND", "版本通知参数无效");
    let notice: string | null = null;
    if (action === "present") {
      const state = this.snapshot();
      if (state.pending && state.latest?.version === version) {
        // Atomic per-backend receipt: multiple windows cannot both claim a popup.
        const row = this.db.prepare("INSERT OR IGNORE INTO backend_update_notices(version,shownAt) VALUES(?,?)").run(version, this.now());
        if (row.changes) notice = version;
      }
    } else this.db.prepare("INSERT INTO backend_update_notices VALUES(?,?,?) ON CONFLICT(version) DO UPDATE SET dismissedAt=excluded.dismissedAt").run(version, this.now(), this.now());
    this.publish(); return { ...this.snapshot(), notice };
  }
  close() { this.closed = true; clearTimeout(this.timer); this.abort?.abort(); }
}
