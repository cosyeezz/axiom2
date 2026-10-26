import { createHash } from "node:crypto";
import type { Store } from "./storage.js";
import type { MemoryPurpose } from "../shared/memory-tree.js";
import { AppError } from "../shared/protocol.js";

/** Configuration identity ignores object-key order, but preserves array order. */
export const organizationJSON = (value: unknown) => JSON.stringify(value, (_key, item) =>
  item && typeof item === "object" && !Array.isArray(item) ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) : item);

/** Persistent claims are separate from source-locator quarantine. Scans cannot
 * accidentally re-enable a failed/unknown model request. All keys stay internal. */
export class MemoryOrganizationState {
  constructor(private store: Store, private configuration: (workspaceId: string, purposes: readonly MemoryPurpose[]) => string) {
    store.db.exec(`CREATE TABLE IF NOT EXISTS memory_organization_attempts(
      fingerprint TEXT PRIMARY KEY,workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      batch_ids TEXT NOT NULL,purpose_ids TEXT NOT NULL,state TEXT NOT NULL,attempts INTEGER NOT NULL,
      processing_id TEXT NOT NULL,error TEXT,updated_at INTEGER NOT NULL);`);
  }
  recover() {
    this.store.db.prepare("UPDATE memory_organization_attempts SET state='unknown',error='重启前整理结果未知，未自动重发' WHERE state='running'").run();
    this.store.db.prepare(`UPDATE memory_purposes SET error='重启前整理结果未知，未自动重发'
      WHERE processedAt IS NULL AND id IN (SELECT j.value FROM memory_organization_attempts a,json_each(a.batch_ids) j WHERE a.state='unknown')`).run();
  }
  fingerprint(workspaceId: string, version: number, purposes: readonly MemoryPurpose[]) {
    const sources = purposes.map(purpose => {
      const row = this.store.db.prepare("SELECT body,processedAt,blocked FROM memory_purposes WHERE workspaceId=? AND id=?").get(workspaceId, purpose.id);
      const documents = this.store.db.prepare("SELECT body FROM memory_purpose_documents WHERE purpose_id=?").get(purpose.id);
      return [purpose.id, row ?? null, documents?.body ?? null];
    }).sort((a, b) => String(a[0]).localeCompare(String(b[0])));
    return createHash("sha256").update(JSON.stringify([workspaceId, version, sources, this.configuration(workspaceId, purposes)])).digest("hex");
  }
  excluded(workspaceId: string, version: number, purposes: readonly MemoryPurpose[]) {
    const excluded = new Set<string>(), live = new Map(purposes.map(purpose => [purpose.id, purpose]));
    for (const row of this.store.db.prepare("SELECT * FROM memory_organization_attempts WHERE workspace_id=? AND state IN ('paused','running','unknown')").all(workspaceId)) {
      const ids = JSON.parse(String(row.purpose_ids)) as string[];
      const frozen = ids.map(id => live.get(id)).filter((purpose): purpose is MemoryPurpose => !!purpose);
      if (row.state === "running" || row.state === "unknown" || frozen.length === ids.length && this.fingerprint(workspaceId, version, frozen) === row.fingerprint)
        for (const id of JSON.parse(String(row.batch_ids)) as string[]) excluded.add(id);
    }
    return excluded;
  }
  begin(workspaceId: string, batch: readonly MemoryPurpose[], purposes: readonly MemoryPurpose[], fingerprint: string, processingId: string) {
    const prior = this.store.db.prepare("SELECT state,attempts FROM memory_organization_attempts WHERE fingerprint=?").get(fingerprint);
    if (prior && (prior.state !== "retry" || Number(prior.attempts) >= 2))
      throw new AppError("MEMORY_ORGANIZATION_PAUSED", "本批整理已领取、暂停或发布，未重复请求模型");
    this.store.db.prepare(`INSERT INTO memory_organization_attempts VALUES(?,?,?,?,?,?,?,?,?)
      ON CONFLICT(fingerprint) DO UPDATE SET state='running',attempts=attempts+1,processing_id=excluded.processing_id,error=NULL,updated_at=excluded.updated_at`)
      .run(fingerprint, workspaceId, JSON.stringify(batch.map(p => p.id)), JSON.stringify(purposes.map(p => p.id)), "running", 1, processingId, null, Date.now());
  }
  finish(fingerprint: string, processingId: string) {
    if (!this.store.db.prepare("UPDATE memory_organization_attempts SET state='applied',updated_at=? WHERE fingerprint=? AND processing_id=? AND state='running'")
      .run(Date.now(), fingerprint, processingId).changes) throw new AppError("REVISION_CONFLICT", "整理领取已失效");
  }
  fail(fingerprint: string, processingId: string, error: string, retryable: boolean) {
    const row = this.store.db.prepare("SELECT attempts FROM memory_organization_attempts WHERE fingerprint=? AND processing_id=? AND state='running'").get(fingerprint, processingId);
    if (!row) return undefined;
    const retry = retryable && Number(row.attempts) < 2;
    this.store.db.prepare("UPDATE memory_organization_attempts SET state=?,error=?,updated_at=? WHERE fingerprint=? AND processing_id=?")
      .run(retry ? "retry" : "paused", error, Date.now(), fingerprint, processingId);
    return retry;
  }
}
