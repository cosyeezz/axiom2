import { createHash } from "node:crypto";
import type { Store } from "./storage.js";
import type { MemoryRecord, MemorySource, MemoryTree, MemoryTreeTopic } from "../shared/memory-tree.js";
import { AppError } from "../shared/protocol.js";
export interface MemoryFileContribution extends MemorySource { records: MemoryRecord[]; dependencies: MemorySource[] }
export interface ExistingMemoryRecord { file: MemoryFileContribution; index: number; record: MemoryRecord }
const id = (...parts: string[]) => createHash("sha256").update(JSON.stringify(parts)).digest("hex").slice(0, 24);
export const topicId = (name: string) => `t-${id(name)}`;
export const sectionId = (topic: string, section: string) => `s-${id(topic, section)}`;
export class MemoryTreeStore {
  constructor(private store: Store) {
    store.db.exec(`CREATE TABLE IF NOT EXISTS memory_file_contributions(
      sessionId TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE, path TEXT NOT NULL, revision TEXT NOT NULL, body TEXT NOT NULL,
      PRIMARY KEY(sessionId,path));
      CREATE TABLE IF NOT EXISTS memory_topic_routes(workspaceId TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      topicId TEXT NOT NULL,sectionId TEXT NOT NULL,PRIMARY KEY(workspaceId,topicId,sectionId));
      CREATE TABLE IF NOT EXISTS memory_activity(sessionId TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
      updatedAt INTEGER NOT NULL,version INTEGER NOT NULL);`);
  }
  files(workspaceId: string): MemoryFileContribution[] {
    return this.store.db.prepare(`SELECT c.body FROM memory_file_contributions c JOIN sessions s ON s.id=c.sessionId
      WHERE s.workspaceId=? AND NOT EXISTS(SELECT 1 FROM tasks t WHERE t.sessionId=s.id) ORDER BY c.sessionId,c.path`).all(workspaceId)
      .map((row) => JSON.parse(String(row.body)) as MemoryFileContribution);
  }
  signature(workspaceId: string) { return id(JSON.stringify(this.files(workspaceId))); }
  activity(sessionId: string) {
    const row = this.store.db.prepare("SELECT updatedAt,version FROM memory_activity WHERE sessionId=?").get(sessionId);
    return { updatedAt: Number(row?.updatedAt ?? 0), version: Number(row?.version ?? 0) };
  }
  touch(sessionId: string) {
    this.store.db.prepare(`INSERT INTO memory_activity VALUES(?,?,1) ON CONFLICT(sessionId) DO UPDATE SET updatedAt=excluded.updatedAt,version=version+1`).run(sessionId, Date.now());
  }
  tree(workspaceId: string): MemoryTree {
    const topics = new Map<string, MemoryTreeTopic>();
    for (const file of this.files(workspaceId)) for (const record of file.records) {
      const tid = topicId(record.topic), sid = sectionId(record.topic, record.section);
      let topic = topics.get(tid);
      if (!topic) { topic = { id: tid, name: record.topic, sections: [] }; topics.set(tid, topic); }
      let section = topic.sections.find((entry) => entry.id === sid);
      if (!section) { section = { id: sid, name: record.section, items: [] }; topic.sections.push(section); }
      const iid = `i-${id(tid, sid, record.item)}`;
      let item = section.items.find((entry) => entry.id === iid);
      if (!item) { item = { id: iid, name: record.item, contents: [] }; section.items.push(item); }
      const cid = `c-${id(iid, record.content)}`;
      let content = item.contents.find((entry) => entry.id === cid);
      if (!content) { content = { id: cid, text: record.content, sources: [] }; item.contents.push(content); }
      const { sessionId, path, revision } = file;
      if (!content.sources.some((source) => source.sessionId === sessionId && source.path === path)) content.sources.push({ sessionId, path, revision });
    }
    const result = [...topics.values()].sort((a, b) => a.name.localeCompare(b.name));
    for (const topic of result) {
      topic.sections.sort((a, b) => a.name.localeCompare(b.name));
      for (const section of topic.sections) section.items.sort((a, b) => a.name.localeCompare(b.name));
    }
    return { topics: result, nameChars: result.reduce((sum, topic) => sum + Array.from(topic.name).length, 0) };
  }
  sections(workspaceId: string, topic: string) {
    const tree = this.tree(workspaceId), routes = new Set(this.store.db.prepare("SELECT sectionId FROM memory_topic_routes WHERE workspaceId=? AND topicId=?").all(workspaceId, topic).map((row) => String(row.sectionId)));
    const sections = tree.topics.flatMap((entry) => entry.sections.filter((section) => entry.id === topic || routes.has(section.id)).map((section) => ({ ...section, topic: entry.name })));
    if (!sections.length) throw new AppError("MEMORY_UNAVAILABLE", "Topic范围已失效，请使用最新目录");
    return sections;
  }
  publish(workspaceId: string, file: MemoryFileContribution, existing: ExistingMemoryRecord[], output: MemoryRecord[], expected: string) {
    if (this.signature(workspaceId) !== expected) throw new AppError("REVISION_CONFLICT", "记忆树已变化，未发布旧整理结果");
    if (output.length < existing.length) throw Error("既有记录返回不完整");
    const changed = new Map<string, MemoryFileContribution>();
    const routes = new Map<string, Set<string>>();
    const moves = new Map<string, Set<string>>();
    const move = (record: MemoryRecord, next: MemoryRecord) => {
      const previousSection = sectionId(record.topic, record.section), nextSection = sectionId(next.topic, next.section);
      const targets = routes.get(topicId(record.topic)) ?? new Set<string>(); targets.add(nextSection); routes.set(topicId(record.topic), targets);
      const successors = moves.get(previousSection) ?? new Set<string>(); successors.add(nextSection); moves.set(previousSection, successors);
    };
    const previous = this.files(workspaceId).find((value) => value.sessionId === file.sessionId && value.path === file.path);
    const replacements = output.slice(existing.length);
    for (const record of previous?.records ?? []) {
      const matches = replacements.filter((next) => next.item === record.item);
      // A file can rename its items too. Keep its old directory usable until the next compaction.
      for (const next of matches.length ? matches : replacements) move(record, next);
    }
    for (let index = 0; index < existing.length; index++) {
      const old = existing[index], next = output[index];
      if (old.record.item !== next.item || old.record.content !== next.content) throw Error("既有记录的内容或顺序被修改");
      const key = JSON.stringify([old.file.sessionId, old.file.path]);
      let update = changed.get(key);
      if (!update) { update = { ...old.file, records: [...old.file.records] }; changed.set(key, update); }
      update.records[old.index] = next;
      move(old.record, next);
    }
    this.store.db.exec("BEGIN IMMEDIATE");
    try {
      const save = this.store.db.prepare(`INSERT INTO memory_file_contributions VALUES(?,?,?,?) ON CONFLICT(sessionId,path) DO UPDATE SET revision=excluded.revision,body=excluded.body`);
      for (const value of [...changed.values(), { ...file, records: output.slice(existing.length) }]) save.run(value.sessionId, value.path, value.revision, JSON.stringify(value));
      const liveSections = new Set(this.tree(workspaceId).topics.flatMap((topic) => topic.sections.map((section) => section.id)));
      // Carry older snapshots through repeated splits/merges without reading any successor bodies.
      for (const row of this.store.db.prepare("SELECT topicId,sectionId FROM memory_topic_routes WHERE workspaceId=?").all(workspaceId)) {
        const successors = moves.get(String(row.sectionId));
        if (!successors) continue;
        if (!liveSections.has(String(row.sectionId)))
          this.store.db.prepare("DELETE FROM memory_topic_routes WHERE workspaceId=? AND topicId=? AND sectionId=?").run(workspaceId,row.topicId,row.sectionId);
        const targets = routes.get(String(row.topicId)) ?? new Set<string>();
        for (const target of successors) targets.add(target);
        routes.set(String(row.topicId), targets);
      }
      const route = this.store.db.prepare("INSERT OR IGNORE INTO memory_topic_routes VALUES(?,?,?)");
      for (const [topic, targets] of routes) for (const target of targets) route.run(workspaceId, topic, target);
      this.store.db.exec("COMMIT");
    } catch (error) { this.store.db.exec("ROLLBACK"); throw error; }
  }
  prune(sessionId: string, paths: Set<string>) {
    let changed = false;
    for (const row of this.store.db.prepare("SELECT path FROM memory_file_contributions WHERE sessionId=?").all(sessionId))
      if (!paths.has(String(row.path))) {
        this.store.db.prepare("DELETE FROM memory_file_contributions WHERE sessionId=? AND path=?").run(sessionId, row.path);
        changed = true;
      }
    return changed;
  }
  clear(workspaceId: string) {
    this.store.db.prepare("DELETE FROM memory_file_contributions WHERE sessionId IN(SELECT id FROM sessions WHERE workspaceId=?)").run(workspaceId);
    this.store.db.prepare("DELETE FROM memory_topic_routes WHERE workspaceId=?").run(workspaceId);
  }
}
