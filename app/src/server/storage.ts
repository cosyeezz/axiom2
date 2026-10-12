import { DatabaseSync } from 'node:sqlite';
import { realpathSync, statSync, mkdirSync } from 'node:fs';
import { basename, isAbsolute, join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { AppError, object, text, type Command, type Draft, type Session, type Workspace } from '../shared/protocol.js';

export class Store {
  readonly db: DatabaseSync;
  constructor(readonly root: string) {
    mkdirSync(root, { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(join(root, 'axiom.sqlite'));
    this.db.exec(`PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=3000;
      CREATE TABLE IF NOT EXISTS workspaces(id TEXT PRIMARY KEY,path TEXT NOT NULL,pathKey TEXT NOT NULL UNIQUE,name TEXT NOT NULL,authorized INTEGER NOT NULL CHECK(authorized IN (0,1)));
      CREATE TABLE IF NOT EXISTS sessions(id TEXT PRIMARY KEY,workspaceId TEXT NOT NULL REFERENCES workspaces(id),title TEXT NOT NULL,pinned INTEGER NOT NULL DEFAULT 0,unread INTEGER NOT NULL DEFAULT 0,updatedAt INTEGER NOT NULL,UNIQUE(workspaceId,id));
      CREATE TABLE IF NOT EXISTS drafts(viewId TEXT NOT NULL,workspaceId TEXT NOT NULL,sessionId TEXT NOT NULL,revision INTEGER NOT NULL,body TEXT NOT NULL,PRIMARY KEY(viewId,workspaceId,sessionId),FOREIGN KEY(workspaceId,sessionId) REFERENCES sessions(workspaceId,id) ON DELETE CASCADE);
      CREATE TABLE IF NOT EXISTS requests(id TEXT PRIMARY KEY,hash TEXT NOT NULL,response TEXT NOT NULL);
    `);
  }
  workspaces(): Workspace[] {
    return (this.db.prepare('SELECT id,name,path,authorized FROM workspaces ORDER BY rowid').all() as unknown as Workspace[])
      .map(w => ({ ...w, authorized: !!w.authorized }));
  }
  workspace(id: unknown): Workspace {
    const w = this.workspaces().find(w => w.id === text(id, '工作空间标识'));
    if (!w) throw new AppError('NOT_FOUND', '工作空间不存在');
    return w;
  }
  sessions(workspaceId: unknown): Session[] {
    const w = this.workspace(workspaceId);
    return (this.db.prepare('SELECT * FROM sessions WHERE workspaceId=? ORDER BY pinned DESC,updatedAt DESC,id').all(w.id) as unknown as Session[])
      .map(s => ({ ...s, pinned: !!s.pinned, unread: !!s.unread }));
  }
  session(workspaceId: unknown, sessionId: unknown): Session {
    const s = this.sessions(workspaceId).find(s => s.id === text(sessionId, '会话标识'));
    if (!s) throw new AppError('SCOPE_MISMATCH', '会话不属于该工作空间');
    return s;
  }
  draft(workspaceId: unknown, sessionId: unknown, viewId: unknown): Draft {
    const s = this.session(workspaceId, sessionId);
    const row = this.db.prepare('SELECT body,revision FROM drafts WHERE viewId=? AND workspaceId=? AND sessionId=?')
      .get(text(viewId, '查看实例'), s.workspaceId, s.id);
    return row ? { ...JSON.parse(row.body as string), revision: Number(row.revision) } : { text: '', attachment: null, revision: 0 };
  }
  receipt(requestId: unknown): { status: 'committed'; data: unknown } | { status: 'not_found' } {
    const row = this.db.prepare('SELECT response FROM requests WHERE id=?').get(text(requestId, '请求标识'));
    return row ? { status: 'committed', data: JSON.parse(row.response as string) } : { status: 'not_found' };
  }
  // Synchronous SQLite transaction: mutation and receipt commit together before acknowledgement.
  execute(command: Command): unknown {
    const id = text(command.requestId, '请求标识');
    const hash = createHash('sha256').update(JSON.stringify(command)).digest('hex');
    const previous = this.db.prepare('SELECT hash,response FROM requests WHERE id=?').get(id);
    if (previous) {
      if (previous.hash !== hash) throw new AppError('REQUEST_CONFLICT', '同一请求标识不能使用不同参数');
      return JSON.parse(previous.response as string);
    }
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = this.mutate(command);
      this.db.prepare('INSERT INTO requests VALUES(?,?,?)').run(id, hash, JSON.stringify(result));
      this.db.exec('COMMIT');
      return result;
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  private mutate(c: Command): unknown {
    const p = object(c.params ?? {});
    if (c.op === 'workspace.open') {
      if (p.authorized !== true) throw new AppError('AUTHORIZATION_REQUIRED', '请明确授权项目访问');
      const input = text(p.path, '项目绝对路径', 4096);
      if (!isAbsolute(input)) throw new AppError('INVALID_PATH', '请输入服务端项目的绝对路径');
      let path: string;
      try { path = realpathSync.native(input); if (!statSync(path).isDirectory()) throw Error(); }
      catch { throw new AppError('INVALID_PATH', '目录不存在或无法访问'); }
      // Only Windows folds case; macOS volumes may be case-sensitive.
      const key = process.platform === 'win32' ? path.toLowerCase() : path;
      this.db.prepare('INSERT OR IGNORE INTO workspaces VALUES(?,?,?,?,1)').run(randomUUID(), path, key, basename(path) || path);
      return this.workspaces().find(w => (process.platform === 'win32' ? w.path.toLowerCase() : w.path) === key)!;
    }
    if (c.op === 'session.create') {
      const w = this.workspace(c.workspaceId), id = randomUUID();
      this.db.prepare('INSERT INTO sessions(id,workspaceId,title,updatedAt) VALUES(?,?,?,?)').run(id, w.id, '新对话', Date.now());
      return this.session(w.id, id);
    }
    const s = this.session(c.workspaceId, c.sessionId);
    if (c.op === 'session.rename') this.db.prepare('UPDATE sessions SET title=?,updatedAt=? WHERE id=?').run(text(p.title, '标题', 120), Date.now(), s.id);
    else if (c.op === 'session.pin') {
      if (typeof p.pinned !== 'boolean') throw new AppError('INVALID_INPUT', '置顶状态必须为布尔值');
      this.db.prepare('UPDATE sessions SET pinned=? WHERE id=?').run(Number(p.pinned), s.id);
    } else if (c.op === 'session.delete') {
      if (p.confirmed !== true) throw new AppError('CONFIRMATION_REQUIRED', '删除会话需要确认');
      this.db.prepare('DELETE FROM sessions WHERE id=?').run(s.id);
      return { deleted: s.id };
    } else if (c.op === 'draft.save') {
      const view = text(p.viewId, '查看实例');
      if (typeof p.text !== 'string' || p.text.length > 12000) throw new AppError('INVALID_INPUT', '草稿不能超过 12000 字符');
      let attachment = null;
      if (p.attachment !== null && p.attachment !== undefined) {
        const a = object(p.attachment), name = text(a.name, '附件名称', 255);
        if (!/\.(txt|md|js|jsx|ts|tsx|json|py|css|html)$/i.test(name) || typeof a.text !== 'string' || Buffer.byteLength(a.text) > 100000 || a.text.includes('\0'))
          throw new AppError('INVALID_ATTACHMENT', '仅支持小于 100 KB 的文本或代码文件');
        attachment = { name, text: a.text };
      }
      const current = this.draft(s.workspaceId, s.id, view);
      if (p.revision !== current.revision) throw new AppError('REVISION_CONFLICT', '草稿已更新，请重新读取');
      const draft = { text: p.text, attachment, revision: current.revision + 1 };
      this.db.prepare('INSERT INTO drafts VALUES(?,?,?,?,?) ON CONFLICT(viewId,workspaceId,sessionId) DO UPDATE SET revision=excluded.revision,body=excluded.body')
        .run(view, s.workspaceId, s.id, draft.revision, JSON.stringify({ text: draft.text, attachment }));
      return draft;
    } else if (c.op === 'prompt') {
      throw new AppError('AGENT_NOT_READY', '主 Agent 尚未接入，未发起模型请求');
    } else throw new AppError('UNKNOWN_OPERATION', '不支持的操作');
    return this.session(s.workspaceId, s.id);
  }
  close() { this.db.close(); }
}
