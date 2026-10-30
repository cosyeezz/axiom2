import { AppError, text, type Scope, type Session } from "../shared/protocol.js";
import type { SessionListCursor, SessionListGroup, SessionListInitial, SessionListItem, SessionListPage } from "../shared/session-list.js";
import type { Store } from "./storage.js";

interface Locator {
  id: string;
  familyId: string;
  familyTop: number;
  familyRank: number;
  memberRank: number;
}

// This bounds rows crossing into JS, not the SQL scan/sort or deep-tree path cost.
// Resolve family membership BEFORE ranking: every member of a top family uses a
// fixed anchor, so activity cannot move either siblings or the whole family.
// Normal UUID tie buckets use BINARY. Arbitrary legacy IDs use localeCompare only
// inside their equal-priority/time bucket (worst-case quadratic in that bucket).
const locators = `/* session-list locators */ WITH RECURSIVE
eligible AS MATERIALIZED (
  SELECT s.id,s.workspaceId,s.forkParentSessionId,s.updatedAt,COALESCE(s.listOrderAt,s.updatedAt) AS listOrderAt,s.pinned,s.unread,s.autoPinUntil,
    (SELECT r.status FROM runs r WHERE r.sessionId=s.id ORDER BY r.startedAt DESC,r.rowid DESC LIMIT 1) AS runStatus,
    EXISTS(SELECT 1 FROM tasks t WHERE t.parentSessionId=s.id
      AND t.status IN ('queued','starting','running','stopping')) AS taskActive
  FROM sessions s JOIN workspaces w ON w.id=s.workspaceId
  WHERE s.deletedAt IS NULL AND w.archived=0
    AND NOT EXISTS(SELECT 1 FROM tasks t WHERE t.sessionId=s.id)
    AND instr(axiom_list_lower(s.title),:queryFold)>0
), automatic AS (
  SELECT *,CASE WHEN unread=1 OR taskActive=1 OR runStatus IN ('starting','running','stopping')
    OR autoPinUntil>0 THEN 1 ELSE 0 END AS selfAuto FROM eligible
), flags AS (
  SELECT *,CASE WHEN pinned=1 OR selfAuto=1 THEN 1 ELSE 0 END AS selfTop FROM automatic
), pool AS MATERIALIZED (
  SELECT * FROM flags WHERE workspaceId=:workspaceId OR selfTop=1
), edge AS MATERIALIZED (
  SELECT c.id,p.id AS parentId FROM pool c LEFT JOIN pool p
    ON p.id=c.forkParentSessionId AND p.workspaceId=c.workspaceId AND p.id<>c.id
), ancestry(id,familyId) AS (
  SELECT id,id FROM edge WHERE parentId IS NULL
  UNION ALL
  SELECT e.id,a.familyId FROM ancestry a JOIN edge e ON e.parentId=a.id
), members AS MATERIALIZED (
  SELECT * FROM ancestry
  UNION ALL
  SELECT p.id,p.id FROM pool p WHERE NOT EXISTS(SELECT 1 FROM ancestry a WHERE a.id=p.id)
), familyFlags AS (
  SELECT m.familyId,MAX(p.selfTop) AS familyTop FROM members m JOIN pool p ON p.id=m.id GROUP BY m.familyId
), sortable AS MATERIALIZED (
  SELECT p.*,m.familyId,f.familyTop,CASE WHEN f.familyTop=1 THEN p.listOrderAt ELSE p.updatedAt END AS orderAt
    FROM pool p JOIN members m ON m.id=p.id JOIN familyFlags f USING(familyId)
), ties AS MATERIALIZED (
  SELECT *,MAX(CASE WHEN axiom_list_uuid(id) THEN 0 ELSE 1 END)
    OVER (PARTITION BY familyTop,orderAt) AS localeTie FROM sortable
), ranked AS MATERIALIZED (
  SELECT *,ROW_NUMBER() OVER (ORDER BY a.familyTop DESC,a.orderAt DESC,
    CASE WHEN a.localeTie=1 THEN (
      SELECT COUNT(*) FROM sortable b WHERE b.familyTop=a.familyTop AND b.orderAt=a.orderAt
        AND axiom_list_compare(b.id,a.id)<0
    ) ELSE a.id END COLLATE BINARY,
    CASE WHEN a.workspaceId=:workspaceId THEN 0 ELSE 1 END,a.id COLLATE BINARY) AS selfRank
  FROM ties a
), tree(id,familyId,path) AS (
  SELECT id,familyId,printf('%020d',selfRank) FROM ranked WHERE id=familyId
  UNION ALL
  SELECT e.id,t.familyId,t.path||'/'||printf('%020d',r.selfRank)
    FROM tree t JOIN edge e ON e.parentId=t.id JOIN ranked r ON r.id=e.id AND r.familyId=t.familyId
), orderedMembers AS (
  SELECT id,familyId,ROW_NUMBER() OVER (PARTITION BY familyId ORDER BY path COLLATE BINARY) AS memberRank FROM tree
), families AS (
  SELECT familyId,MAX(familyTop) AS familyTop,MIN(selfRank) AS familyRank FROM ranked GROUP BY familyId
), ordered AS (
  SELECT m.id,m.familyId,f.familyTop,f.familyRank,m.memberRank
    FROM orderedMembers m JOIN families f USING(familyId) JOIN ranked r ON r.id=m.id
    WHERE (:group='top' AND f.familyTop=1)
       OR (:group='workspace' AND f.familyTop=0 AND r.workspaceId=:workspaceId)
)
SELECT * FROM ordered WHERE (familyRank,memberRank)>(:familyRank,:memberRank)
ORDER BY familyRank,memberRank LIMIT 31`;

const summary = `/* session-list summaries */ SELECT s.*,r.id AS runId,r.status AS runStatus,r.phase,r.retry,r.reasonCode,
  (SELECT COUNT(*) FROM tasks WHERE parentSessionId=s.id
    AND status IN ('queued','starting','running','stopping')) AS activeTaskCount
  FROM sessions s LEFT JOIN runs r ON r.id=(SELECT id FROM runs WHERE sessionId=s.id ORDER BY startedAt DESC,rowid DESC LIMIT 1)
  WHERE s.id IN `;
const visible = `s.deletedAt IS NULL AND EXISTS(SELECT 1 FROM workspaces w WHERE w.id=s.workspaceId AND w.archived=0)`;
const main = `NOT EXISTS(SELECT 1 FROM tasks t WHERE t.sessionId=s.id)`;

/** Independent paged UI projection; Store's internal full-list consumers stay intact. */
export class SessionLists {
  constructor(private readonly store: Store, private readonly streamId: string) {
    store.db.function("axiom_list_lower", { deterministic: true }, value => String(value).toLowerCase());
    store.db.function("axiom_list_compare", { deterministic: true }, (a, b) => String(a).localeCompare(String(b)));
    store.db.function("axiom_list_uuid", { deterministic: true }, value =>
      Number(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(String(value))));
    // Install before exposing requests/starting agents. There are no cursors before
    // this instance; persisted triggers cover all subsequent writes and rollbacks.
    store.db.exec(`CREATE TABLE IF NOT EXISTS session_list_state(
      id INTEGER PRIMARY KEY CHECK(id=1),revision INTEGER NOT NULL CHECK(revision>=0));
      INSERT OR IGNORE INTO session_list_state(id,revision) VALUES(1,0);
      CREATE INDEX IF NOT EXISTS sessions_list_first ON sessions(workspaceId,deletedAt,pinned DESC,updatedAt DESC,id);`);
    const columns = {
      sessions: ["id", "workspaceId", "title", "forkParentSessionId", "deletedAt", "pinned", "unread", "autoPinUntil", "updatedAt", "resultVersion", "readVersion"],
      runs: ["id", "sessionId", "startedAt", "status", "phase", "retry", "reasonCode"],
      tasks: ["workspaceId", "parentSessionId", "sessionId", "status"],
      workspaces: ["id", "archived"],
    };
    for (const [table, fields] of Object.entries(columns)) {
      for (const event of ["INSERT", "DELETE", "UPDATE"] as const) {
        const update = event === "UPDATE";
        store.db.exec(`CREATE TRIGGER IF NOT EXISTS session_list_${table}_${event.toLowerCase()}
          AFTER ${event}${update ? ` OF ${fields.join(",")}` : ""} ON ${table}
          ${update ? `WHEN ${fields.map(field => `NEW.${field} IS NOT OLD.${field}`).join(" OR ")}` : ""}
          BEGIN UPDATE session_list_state SET revision=revision+1 WHERE id=1; END;`);
      }
    }
  }

  revision(): number {
    const revision = this.store.prepare("SELECT revision FROM session_list_state WHERE id=1").get()!.revision as number;
    if (!Number.isSafeInteger(revision) || revision < 0) throw new AppError("REVISION_UNAVAILABLE", "会话列表版本不可用");
    return revision;
  }

  page(workspaceId: unknown, group: unknown, query: unknown = "", cursor: unknown = null): SessionListPage {
    this.identifier(workspaceId);
    if ((group !== "top" && group !== "workspace") || typeof query !== "string")
      throw new AppError("INVALID_INPUT", "会话分页参数无效");
    return this.read(() => {
      this.store.workspace(workspaceId);
      const revision = this.revision();
      const after = this.cursor(cursor, workspaceId, group, query, revision);
      const rows = this.store.prepare(locators).all({ workspaceId, group, queryFold: query.toLowerCase(),
        familyRank: after?.familyRank ?? 0, memberRank: after?.memberRank ?? 0 }) as unknown as Locator[];
      const page = rows.slice(0, 30), byId = new Map(this.hydrate(page.map(row => row.id)).map(row => [row.id, row]));
      const items: SessionListItem[] = page.map(row => ({ ...byId.get(row.id)!, familyId: row.familyId, familyTop: !!row.familyTop }));
      const last = page.at(-1);
      return { items, revision, next: rows.length > 30 && last ? {
        version: 1, streamId: this.streamId, revision, workspaceId, group, query,
        familyRank: last.familyRank, memberRank: last.memberRank,
      } : null };
    });
  }

  /** Both first pages belong to one snapshot, even with an external WAL writer. */
  initial(workspaceId: unknown, query: unknown = ""): SessionListInitial {
    return this.read(() => {
      const top = this.page(workspaceId, "top", query), workspace = this.page(workspaceId, "workspace", query);
      return { top, workspace, revision: top.revision };
    });
  }

  /** Authority does not depend on the title query, current page or top membership. */
  summary(workspaceId: unknown, sessionId: unknown): Session | null {
    this.identifier(workspaceId); this.identifier(sessionId);
    return this.read(() => {
      const row = this.store.prepare(`SELECT s.id FROM sessions s WHERE s.workspaceId=? AND s.id=? AND ${visible}`)
        .get(workspaceId, sessionId);
      return row ? this.hydrate([row.id as string])[0] : null;
    });
  }

  /** Validate the WHOLE bounded batch before any transcript can be opened. */
  countScopes(workspaceId: unknown, value: unknown): Scope[] {
    const id = text(workspaceId, "工作空间标识");
    if (!Array.isArray(value) || value.length < 1 || value.length > 30)
      throw new AppError("INVALID_INPUT", "计数每次须提供 1–30 个会话");
    const ids = value.map(value => {
      const parsed = text(value, "会话标识");
      if (parsed !== value) throw new AppError("INVALID_INPUT", "会话标识无效");
      return parsed;
    });
    if (new Set(ids).size !== ids.length) throw new AppError("INVALID_INPUT", "会话标识不能重复");
    return this.read(() => {
      this.store.workspace(id);
      return ids.map(sessionId => {
        this.store.session(id, sessionId);
        return { workspaceId: id, sessionId };
      });
    });
  }

  /** Preserve the legacy full workspace list's first-row fallback, not a loaded page's. */
  first(workspaceId: unknown): Session | null {
    this.identifier(workspaceId);
    return this.read(() => {
      const row = this.store.prepare(`SELECT s.id FROM sessions s WHERE s.workspaceId=? AND ${visible} AND ${main}
        ORDER BY s.pinned DESC,s.updatedAt DESC,s.id LIMIT 1`).get(workspaceId);
      return row ? this.hydrate([row.id as string])[0] : null;
    });
  }

  private hydrate(ids: string[]): Session[] {
    if (!ids.length) return [];
    const rows = this.store.prepare(summary + `(${ids.map(() => "?").join(",")})`).all(...ids) as unknown as Session[];
    return rows.map(row => ({ ...row, pinned: !!row.pinned, unread: !!row.unread,
      activeTasks: !!row.activeTaskCount, retry: row.retry ? JSON.parse(String(row.retry)) : null }));
  }

  private identifier(value: unknown): asserts value is string {
    if (typeof value !== "string" || !value) throw new AppError("INVALID_INPUT", "会话或工作空间标识无效");
  }

  private cursor(value: unknown, workspaceId: string, group: SessionListGroup, query: string, revision: number): SessionListCursor | null {
    if (value == null) return null;
    const invalid = () => { throw new AppError("INVALID_INPUT", "会话分页位置无效"); };
    if (typeof value !== "object" || Array.isArray(value)) return invalid();
    const c = value as SessionListCursor;
    if (c.version !== 1 || typeof c.streamId !== "string" || typeof c.workspaceId !== "string" || typeof c.query !== "string" ||
      (c.group !== "top" && c.group !== "workspace") || !Number.isSafeInteger(c.revision) || c.revision < 0 ||
      !Number.isSafeInteger(c.familyRank) || c.familyRank < 1 || !Number.isSafeInteger(c.memberRank) || c.memberRank < 1) return invalid();
    if (c.streamId !== this.streamId || c.revision !== revision || c.workspaceId !== workspaceId || c.group !== group || c.query !== query)
      throw new AppError("CURSOR_STALE", "会话列表已变化，请重新加载");
    return c;
  }

  private read<T>(body: () => T): T {
    this.store.db.exec("SAVEPOINT session_list_read");
    try {
      const value = body();
      this.store.db.exec("RELEASE session_list_read");
      return value;
    } catch (error) {
      this.store.db.exec("ROLLBACK TO session_list_read; RELEASE session_list_read");
      throw error;
    }
  }
}
