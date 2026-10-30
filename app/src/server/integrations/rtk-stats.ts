import { DatabaseSync } from "node:sqlite";
import { mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { emptyRtkStats, type RtkEvent, type RtkStats } from "../../shared/rtk.js";
import { rtkDirectory } from "./rtk-config.js";
const day = 86_400_000;
function database<T>(root: string, work: (db: DatabaseSync) => T): T {
  const dir = rtkDirectory(root); mkdirSync(dir, { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(join(dir, "effects.sqlite"));
  try {
    db.exec(`PRAGMA busy_timeout=150; PRAGMA journal_mode=WAL;
      CREATE TABLE IF NOT EXISTS effects (id TEXT PRIMARY KEY, at INTEGER NOT NULL, role TEXT NOT NULL, level TEXT NOT NULL, filter TEXT NOT NULL, reason TEXT NOT NULL, inputBytes INTEGER NOT NULL, outputBytes INTEGER NOT NULL, durationMs REAL NOT NULL, version TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS effects_at ON effects(at);`);
    // Serialize the additive migration across main/subagent workers. Legacy rows
    // retain their postprocess meaning; explicit INSERT columns also support old callers.
    db.exec("BEGIN IMMEDIATE");
    if (!(db.prepare("PRAGMA table_info(effects)").all() as { name: string }[]).some(column => column.name === "stage")) db.exec("ALTER TABLE effects ADD COLUMN stage TEXT NOT NULL DEFAULT 'postprocess'");
    db.exec("COMMIT");
    return work(db);
  } finally { db.close(); }
}
function pruneEvents(db: DatabaseSync) {
  db.prepare("DELETE FROM effects WHERE at < ? OR id IN (SELECT id FROM effects ORDER BY at DESC, id DESC LIMIT -1 OFFSET 5000)").run(Date.now() - 30 * day);
}
export function cleanRtkStats(root: string) { database(root, pruneEvents); }
export function recordRtkEvent(root: string, event: RtkEvent) {
  database(root, db => {
    db.prepare("INSERT OR IGNORE INTO effects (id,at,role,level,filter,reason,inputBytes,outputBytes,durationMs,version,stage) VALUES(?,?,?,?,?,?,?,?,?,?,?)").run(event.id, event.at, event.role, event.level, event.filter, event.reason, event.inputBytes, event.outputBytes, event.durationMs, event.version, event.stage ?? "postprocess");
    pruneEvents(db);
  });
}
export function rtkStats(root: string, days = 7): RtkStats {
  try { return database(root, db => {
    pruneEvents(db);
    const since = Date.now() - days * day;
    const totals = db.prepare("SELECT count(*) AS count, coalesce(sum(reason='filtered'),0) AS filtered, coalesce(sum(inputBytes),0) AS inputBytes, coalesce(sum(outputBytes),0) AS outputBytes, coalesce(sum(durationMs),0) AS durationMs FROM effects WHERE at>=? AND stage='postprocess'").get(since)!;
    const rewrites = db.prepare("SELECT count(*) AS count, coalesce(sum(reason='rewritten'),0) AS adopted, coalesce(sum(durationMs),0) AS durationMs FROM effects WHERE at>=? AND stage='rewrite'").get(since)!;
    const reasons = db.prepare("SELECT reason,count(*) AS count FROM effects WHERE at>=? GROUP BY reason ORDER BY count DESC").all(since) as RtkStats["reasons"];
    const recent = db.prepare("SELECT * FROM effects WHERE at>=? ORDER BY at DESC,id DESC LIMIT 50").all(since) as RtkEvent[];
    return { days, count: Number(totals.count), filtered: Number(totals.filtered), inputBytes: Number(totals.inputBytes), outputBytes: Number(totals.outputBytes), durationMs: Number(totals.durationMs), rewriteCount: Number(rewrites.count), rewritten: Number(rewrites.adopted), rewriteDurationMs: Number(rewrites.durationMs), reasons, recent };
  }); } catch { return { ...emptyRtkStats, days, error: "无法读取 RTK 效果记录，请检查数据目录权限与磁盘空间。" }; }
}
export function clearRtkStats(root: string) { database(root, db => db.exec("DELETE FROM effects")); }
export function cleanRtkOriginals(root: string, all = false) {
  const dir = join(rtkDirectory(root), "originals");
  let names: string[]; try { names = readdirSync(dir); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return; throw error; }
  const files = names.filter(name => /^[a-f0-9-]{36}\.txt$/.test(name)).flatMap(name => { try { return [{ path: join(dir, name), at: statSync(join(dir, name)).mtimeMs }]; } catch { return []; } }).sort((a, b) => b.at - a.at);
  for (const [index, file] of files.entries()) if (all || index >= 200 || file.at < Date.now() - 7 * day) rmSync(file.path, { force: true });
}
export function saveRtkOriginal(root: string, id: string, text: string) {
  const dir = join(rtkDirectory(root), "originals"); mkdirSync(dir, { recursive: true, mode: 0o700 });
  const path = join(dir, `${id}.txt`);
  writeFileSync(path, text, { flag: "wx", mode: 0o600 });
  cleanRtkOriginals(root);
  return path;
}
