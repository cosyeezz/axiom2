import type { Store } from "./storage.js";
import { existingMemoryDetails } from "../shared/memory-detail-paths.js";
import { memoryPurposes } from "../shared/memory-purposes.js";
import { memoryOutline } from "../shared/memory-outline.js";
import { locateMemoryPurpose, queryMemorySnapshot } from "../shared/memory-purpose-locator.js";
import { isMemoryTitle, type MemoryDocumentRef, type MemoryIndexNode, type MemoryPurpose, type MemoryTree } from "../shared/memory-tree.js";
import type { Scope } from "../shared/protocol.js";
import { memoryNodePath, uniqueMemoryDocuments } from "../shared/memory-directory.js";
import { projectMemoryTree } from "../shared/memory-query-projection.js";

export interface MemoryNodeMigrationReport { mergedPaths: string[]; legacyTitles: string[] }
export function preflightMemoryNodes(tree: MemoryTree): MemoryNodeMigrationReport {
  const paths = new Set<string>(), merged = new Set<string>(), legacy = new Set<string>();
  const visit = (node: MemoryIndexNode, ancestors: string[]) => {
    const parts = [...ancestors, node.name];
    if (isMemoryTitle(node)) {
      if (!/^[\p{Script=Han}A-Za-z]+$/u.test(node.name)) legacy.add(parts.join(" / "));
      return;
    }
    const path = memoryNodePath(parts);
    if (paths.has(path)) merged.add(path);
    paths.add(path);
    // Original purpose titles are immutable. Report, never silently sanitize them.
    if (!/^[\p{Script=Han}A-Za-z]+$/u.test(node.name)) legacy.add(path);
    node.children.forEach(child => visit(child, parts));
  };
  tree.roots.forEach(node => visit(node, []));
  return { mergedPaths: [...merged], legacyTitles: [...legacy] };
}
const documentKey = (ref: Pick<MemoryDocumentRef, "sessionId" | "path">) => JSON.stringify([ref.sessionId, ref.path]);
/** A normalized published directory. The legacy JSON is retained solely as the
 * organizer's source/compatibility projection; query/UI read these rows. All
 * mutations run inside MemoryTreeStore's synchronous publication transaction. */
export class MemoryNodeStore {
  constructor(private store: Store) {
    store.db.exec(`CREATE TABLE IF NOT EXISTS memory_directory_nodes(
      id INTEGER PRIMARY KEY,workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      title TEXT NOT NULL,parent_id INTEGER NOT NULL,depth INTEGER NOT NULL,ancestor_ids TEXT NOT NULL,
      title_path TEXT NOT NULL,purpose_ids TEXT NOT NULL,document_refs TEXT NOT NULL,
      position INTEGER NOT NULL,active INTEGER NOT NULL DEFAULT 1,UNIQUE(workspace_id,title_path));
      CREATE INDEX IF NOT EXISTS memory_directory_children ON memory_directory_nodes(workspace_id,parent_id,active,position);
      CREATE TABLE IF NOT EXISTS memory_node_sequence(id INTEGER PRIMARY KEY CHECK(id=1),next_id INTEGER NOT NULL);
      INSERT OR IGNORE INTO memory_node_sequence VALUES(1,0);
      CREATE TABLE IF NOT EXISTS memory_node_indexes(workspace_id TEXT PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
        version INTEGER NOT NULL,report TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS memory_purpose_documents(purpose_id TEXT PRIMARY KEY REFERENCES memory_purposes(id) ON DELETE CASCADE,body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS memory_directory_titles(
        id INTEGER PRIMARY KEY,workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        parent_id INTEGER NOT NULL,title TEXT NOT NULL,purpose_ids TEXT NOT NULL,document_refs TEXT NOT NULL,
        position INTEGER NOT NULL,active INTEGER NOT NULL DEFAULT 1,UNIQUE(workspace_id,parent_id,title));
      CREATE TABLE IF NOT EXISTS memory_directory_layout(workspace_id TEXT PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,version INTEGER NOT NULL);`);
  }
  initialized(workspaceId: string) {
    return !!this.store.db.prepare("SELECT 1 FROM memory_node_indexes i JOIN memory_directory_layout l USING(workspace_id) WHERE workspace_id=? AND l.version=2").get(workspaceId);
  }
  /** No filesystem reads: scan metadata is the only discovery input. Keep refs
   * append-only; a revoked purpose is excluded at publication, not resurrected. */
  syncSource(scope: Scope, entry: string, files: readonly { path: string }[], purposes: readonly MemoryPurpose[]): string[] {
    const relevant = purposes.filter(purpose => purpose.source.sessionId === scope.sessionId);
    if (!relevant.length) return [];
    const headings = memoryPurposes(entry), details = existingMemoryDetails(entry, files), changed: string[] = [];
    const outline = memoryOutline(entry.replace(/^\uFEFF/, ""));
    const ancestry = (parent: number | null) => {
      const result: Array<{ title: string; state: string }> = [];
      while (parent !== null) {
        const node = outline.nodes[parent];
        result.push({ title: node.title, state: node.abandoned ? "已放弃" : node.state ?? "" });
        parent = node.parent;
      }
      return result.reverse();
    };
    for (const purpose of relevant) {
      const heading = locateMemoryPurpose(purpose, headings, purposes);
      if (!heading?.complete) continue;
      const old = this.store.db.prepare("SELECT body FROM memory_purpose_documents WHERE purpose_id=?").get(purpose.id);
      const refs = new Map<string, MemoryDocumentRef>((old ? JSON.parse(String(old.body)) as MemoryDocumentRef[] : []).map(ref => [documentKey(ref), ref]));
      for (const { node, path } of details) {
        if (node.line < heading.line || node.line >= heading.endLine) continue;
        const ref: MemoryDocumentRef = { sessionId: scope.sessionId, path, title: node.title,
          state: node.abandoned ? "已放弃" : node.state ?? "", purposeIds: [purpose.id], ancestors: ancestry(node.parent) };
        refs.set(documentKey(ref), ref);
      }
      const body = JSON.stringify([...refs.values()]);
      if (body === old?.body || !old && !refs.size) continue;
      this.store.db.prepare("INSERT INTO memory_purpose_documents VALUES(?,?) ON CONFLICT(purpose_id) DO UPDATE SET body=excluded.body").run(purpose.id, body);
      changed.push(purpose.id);
    }
    return changed;
  }
  /** Include retained/revoked bindings so an explicit link cannot revive a
   * document whose own purpose has been invalidated. Capture before matching. */
  documentReferences(workspaceId: string): MemoryDocumentRef[] {
    return uniqueMemoryDocuments(this.store.db.prepare(`SELECT d.body FROM memory_purpose_documents d
      JOIN memory_purposes p ON p.id=d.purpose_id WHERE p.workspaceId=?`).all(workspaceId)
      .flatMap(row => JSON.parse(String(row.body)) as MemoryDocumentRef[]));
  }
  publish(input: MemoryTree, workspaceId: string) {
    const source = queryMemorySnapshot(input), seen = new Set<string>();
    const sourcesByTitle = new Map<string, string[]>();
    for (const purpose of source.purposes) sourcesByTitle.set(purpose.text, [...sourcesByTitle.get(purpose.text) ?? [], purpose.id]);
    // Old ID-based trees may repeat one title across categories. Keep its first
    // navigation entry, bind every exact-name source, and prune emptied categories.
    const bindTitles = (nodes: MemoryIndexNode[]): MemoryIndexNode[] => nodes.flatMap(node => {
      if (isMemoryTitle(node)) {
        if (seen.has(node.name)) return [];
        seen.add(node.name);
        return [{ ...node, purposeIds: sourcesByTitle.get(node.name) ?? node.purposeIds ?? (node.purposeId ? [node.purposeId] : []) }];
      }
      const children = bindTitles(node.children);
      return children.length ? [{ ...node, children }] : [];
    });
    const tree = { ...source, roots: bindTitles(source.roots) }, report = preflightMemoryNodes(tree);
    const documents = new Map(tree.purposes.map(purpose => {
      const row = this.store.db.prepare("SELECT body FROM memory_purpose_documents WHERE purpose_id=?").get(purpose.id);
      return [purpose.id, row ? JSON.parse(String(row.body)) as MemoryDocumentRef[] : []] as const;
    }));
    // Legacy roles come from the lossless source tree, never guessed from leaf depth.
    const semanticPaths = new Set<string>();
    const collect = (nodes: MemoryIndexNode[], parents: string[]) => nodes.forEach(node => {
      if (isMemoryTitle(node)) return;
      const parts = [...parents, node.name]; semanticPaths.add(memoryNodePath(parts)); collect(node.children, parts);
    });
    collect(tree.roots, []);
    if (!this.initialized(workspaceId)) {
      for (const row of this.store.db.prepare("SELECT id,title_path FROM memory_directory_nodes WHERE workspace_id=?").all(workspaceId)) {
        if (!semanticPaths.has(String(row.title_path)))
          this.store.db.prepare("UPDATE memory_directory_nodes SET active=0,title_path=? WHERE id=?")
            .run(JSON.stringify(["retired-title", row.id, row.title_path]), row.id);
      }
    }
    const known = new Map(this.store.db.prepare("SELECT id,title_path FROM memory_directory_nodes WHERE workspace_id=?").all(workspaceId).map(row => [String(row.title_path), Number(row.id)]));
    const allocate = () => Number(this.store.db.prepare("UPDATE memory_node_sequence SET next_id=next_id+1 WHERE id=1 RETURNING next_id-1 AS id").get()!.id);
    const knownTitles = new Map(this.store.db.prepare("SELECT id,parent_id,title FROM memory_directory_titles WHERE workspace_id=?").all(workspaceId)
      .map(row => [JSON.stringify([Number(row.parent_id), String(row.title)]), Number(row.id)]));
    type Draft = { id: number; name: string; parent: number; depth: number; ancestors: number[]; path: string; position: number };
    const drafts = new Map<string, Draft>();
    const entries = new Map<string, { id: number; parent: number; title: string; purposes: Set<string>; position: number }>();
    let position = 0;
    const visit = (node: MemoryIndexNode, titles: string[], ids: number[]) => {
      if (isMemoryTitle(node)) {
        const parent = ids.at(-1);
        if (parent === undefined || node.children.length) throw Error("原标题必须是语义目录下的叶子");
        const key = JSON.stringify([parent, node.name]);
        let entry = entries.get(key);
        if (!entry) { entry = { id: knownTitles.get(key) ?? allocate(), parent, title: node.name, purposes: new Set(), position: position++ }; entries.set(key, entry); }
        for (const id of node.purposeIds ?? (node.purposeId ? [node.purposeId] : [])) entry.purposes.add(id);
        return;
      }
      const parts = [...titles, node.name], path = memoryNodePath(parts);
      let draft = drafts.get(path);
      if (!draft) {
        draft = { id: known.get(path) ?? allocate(), name: node.name, parent: ids.at(-1) ?? -1,
          depth: ids.length + 1, ancestors: ids, path, position: position++ };
        drafts.set(path, draft);
      }
      node.children.forEach(child => visit(child, parts, [...ids, draft!.id]));
    };
    tree.roots.forEach(node => visit(node, [], []));
    this.store.db.prepare("UPDATE memory_directory_nodes SET active=0 WHERE workspace_id=?").run(workspaceId);
    this.store.db.prepare("UPDATE memory_directory_titles SET active=0 WHERE workspace_id=?").run(workspaceId);
    const save = this.store.db.prepare(`INSERT INTO memory_directory_nodes VALUES(?,?,?,?,?,?,?,?,?,?,1)
      ON CONFLICT(workspace_id,title_path) DO UPDATE SET title=excluded.title,parent_id=excluded.parent_id,depth=excluded.depth,
      ancestor_ids=excluded.ancestor_ids,purpose_ids=excluded.purpose_ids,document_refs=excluded.document_refs,position=excluded.position,active=1`);
    for (const draft of drafts.values())
      save.run(draft.id, workspaceId, draft.name, draft.parent, draft.depth, JSON.stringify(draft.ancestors), draft.path, "[]", "[]", draft.position);
    const saveTitle = this.store.db.prepare(`INSERT INTO memory_directory_titles VALUES(?,?,?,?,?,?,?,1)
      ON CONFLICT(workspace_id,parent_id,title) DO UPDATE SET purpose_ids=excluded.purpose_ids,document_refs=excluded.document_refs,position=excluded.position,active=1`);
    for (const entry of entries.values()) {
      const ids = [...entry.purposes], refs = uniqueMemoryDocuments(ids.flatMap(id => documents.get(id) ?? []));
      saveTitle.run(entry.id, workspaceId, entry.parent, entry.title, JSON.stringify(ids), JSON.stringify(refs), entry.position);
    }
    this.store.db.prepare("INSERT INTO memory_node_indexes VALUES(?,?,?) ON CONFLICT(workspace_id) DO UPDATE SET version=excluded.version,report=excluded.report")
      .run(workspaceId, tree.version, JSON.stringify(report));
    this.store.db.prepare("INSERT INTO memory_directory_layout VALUES(?,2) ON CONFLICT(workspace_id) DO UPDATE SET version=2").run(workspaceId);
  }
  snapshot(workspaceId: string, legacy: MemoryTree): MemoryTree {
    const nodes = new Map<string, MemoryIndexNode>(), roots: MemoryIndexNode[] = [], positions = new Map<string, number>();
    for (const row of this.store.db.prepare("SELECT * FROM memory_directory_nodes WHERE workspace_id=? AND active=1 ORDER BY position").all(workspaceId)) {
      const node: MemoryIndexNode = { id: String(row.id), kind: "directory", name: String(row.title), titlePath: String(row.title_path), parentId: String(row.parent_id),
        depth: Number(row.depth), ancestorIds: (JSON.parse(String(row.ancestor_ids)) as number[]).map(String),
        purposeIds: JSON.parse(String(row.purpose_ids)), documentRefs: JSON.parse(String(row.document_refs)), children: [] };
      nodes.set(node.id, node); positions.set(node.id, Number(row.position));
      if (node.parentId === "-1") roots.push(node);
      else {
        const parent = nodes.get(node.parentId!);
        if (!parent) throw Error("记忆节点父级缺失");
        parent.children.push(node);
      }
    }
    for (const row of this.store.db.prepare("SELECT * FROM memory_directory_titles WHERE workspace_id=? AND active=1 ORDER BY position").all(workspaceId)) {
      const parent = nodes.get(String(row.parent_id));
      if (!parent) throw Error("原标题的语义父目录缺失");
      positions.set(String(row.id), Number(row.position));
      parent.children.push({ id: String(row.id), kind: "title", name: String(row.title), parentId: parent.id,
        titlePath: JSON.stringify([...parent.titlePath!.split(" / "), String(row.title)]),
        depth: parent.depth! + 1, ancestorIds: [...parent.ancestorIds!, parent.id],
        purposeIds: JSON.parse(String(row.purpose_ids)), documentRefs: JSON.parse(String(row.document_refs)), children: [] });
    }
    for (const node of nodes.values()) node.children.sort((a, b) => positions.get(a.id)! - positions.get(b.id)!);
    return { ...queryMemorySnapshot(legacy), roots, nameChars: Array.from(projectMemoryTree(roots).catalog).length };
  }
}
