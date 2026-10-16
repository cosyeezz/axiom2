import { createHash } from "node:crypto";
import { AppError, attachmentsInput, object, text, type Draft, type Scope } from "../shared/protocol.js";
import { imagesInput } from "./images.js";
import type { Store } from "./storage.js";
import type { DraftRecord, DraftStamp } from "../shared/drafts.js";

const empty = (): Draft => ({ text: "", attachment: null, attachments: [], images: [] });
export class SessionDrafts {
  constructor(private readonly store: Store) {
    store.db.exec(`CREATE TABLE IF NOT EXISTS session_drafts(
      sessionId TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
      revision INTEGER NOT NULL,writer TEXT NOT NULL,sequence INTEGER NOT NULL,
      body TEXT NOT NULL,hash TEXT NOT NULL,submissionId TEXT,updatedAt INTEGER NOT NULL)`);
  }
  read(scope: Scope): DraftRecord {
    this.store.session(scope.workspaceId, scope.sessionId);
    const row = this.store.db.prepare("SELECT * FROM session_drafts WHERE sessionId=?").get(scope.sessionId);
    if (!row) return { revision: 0, writer: "", sequence: 0, draft: empty() };
    // A process can exit after prompt admission but before the socket acknowledgement.
    // Recover from its durable receipt, never replay the request or restore a sent draft.
    const receipt = row.submissionId ? this.store.receipt(String(row.submissionId), scope) : undefined;
    if (row.submissionId && receipt?.status === "committed") {
      this.consume(scope, { revision: Number(row.revision), writer: String(row.writer), sequence: Number(row.sequence) }, String(row.submissionId));
      return this.read(scope);
    }
    return { revision: Number(row.revision), writer: String(row.writer), sequence: Number(row.sequence),
      draft: JSON.parse(String(row.body)), ...(row.submissionId ? { submissionId: String(row.submissionId), submissionStatus: receipt!.status } : {}) };
  }
  save(scope: Scope, input: unknown): DraftStamp {
    this.store.session(scope.workspaceId, scope.sessionId);
    const p = object(input), value = object(p.draft);
    const writer = text(p.writer, "草稿编辑标识", 100);
    if (!Number.isSafeInteger(p.sequence) || Number(p.sequence) < 1 || !Number.isSafeInteger(p.revision) || Number(p.revision) < 0)
      throw new AppError("INVALID_INPUT", "草稿修订无效");
    // Recovery can merge several inputs beyond the send limit. Preserve whitespace exactly.
    if (typeof value.text !== "string" || value.text.length > 200_000 || value.text.includes("\0"))
      throw new AppError("INVALID_INPUT", "草稿文本最多 200,000 字符，且不能包含空字符");
    const images = imagesInput(value.images);
    const attachments = attachmentsInput(value.attachments, value.attachment, images.length);
    const draft: Draft = { text: value.text, attachment: null, attachments, images };
    const submissionId = p.submissionId === undefined ? null : text(p.submissionId, "发送请求标识");
    if (submissionId) this.store.receipt(submissionId, scope);
    const hash = createHash("sha256").update(JSON.stringify({ draft, submissionId })).digest("hex");
    const current = this.read(scope);
    const row = this.store.db.prepare("SELECT hash FROM session_drafts WHERE sessionId=?").get(scope.sessionId);
    if (current.writer === writer && Number(p.sequence) <= current.sequence) {
      if (Number(p.sequence) === current.sequence && row?.hash !== hash)
        throw new AppError("DRAFT_SEQUENCE_CONFLICT", "同一草稿序号不能保存不同内容");
      return { revision: current.revision, writer: current.writer, sequence: current.sequence };
    }
    if (p.revision !== current.revision && !(current.writer === writer && Number(p.sequence) > current.sequence && Number(p.revision) <= current.revision))
      throw new AppError("DRAFT_CONFLICT", "草稿已在另一窗口修改；当前输入已保留，请选择要保存的内容。");
    const revision = current.revision + 1;
    // Synchronous SQL + single service lease: no asynchronous gap between CAS and write.
    this.store.db.prepare(`INSERT INTO session_drafts(sessionId,revision,writer,sequence,body,hash,submissionId,updatedAt)
      VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(sessionId) DO UPDATE SET revision=excluded.revision,
      writer=excluded.writer,sequence=excluded.sequence,body=excluded.body,hash=excluded.hash,
      submissionId=excluded.submissionId,updatedAt=excluded.updatedAt`)
      .run(scope.sessionId, revision, writer, Number(p.sequence), JSON.stringify(draft), hash, submissionId, Date.now());
    return { revision, writer, sequence: Number(p.sequence) };
  }
  consume(scope: Scope, stamp: DraftStamp, requestId: string) {
    this.store.session(scope.workspaceId, scope.sessionId);
    // Keep writer/sequence/hash as a tombstone against late saves and unload retries.
    this.store.db.prepare(`UPDATE session_drafts SET body=?,submissionId=NULL,revision=revision+1,updatedAt=?
      WHERE sessionId=? AND writer=? AND sequence=? AND submissionId=?`)
      .run(JSON.stringify(empty()), Date.now(), scope.sessionId, stamp.writer, stamp.sequence, requestId);
  }
}
