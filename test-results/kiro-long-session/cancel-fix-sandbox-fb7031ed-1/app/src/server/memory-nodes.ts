import type { Store } from "./storage.js";
import { existingMemoryDetails } from "../shared/memory-detail-paths.js";
import { memoryPurposes } from "../shared/memory-purposes.js";
import { memoryOutline } from "../shared/memory-outline.js";
import { locateMemoryPurpose, queryMemorySnapshot } from "../shared/memory-purpose-locator.js";
import type { MemoryDocumentRef, MemoryIndexNode, MemoryPurpose, MemoryTree } from "../shared/memory-tree.js";
import type { Scope } from "../shared/protocol.js";
import { memoryNodePath, uniqueMemoryDocuments } from "../shared/memory-directory.js";

export interface MemoryNodeMigrationReport { mergedPaths: string[]; legacyTitles: string[] }
export function preflightMemoryNodes(tree: MemoryTree): MemoryNodeMigrationReport {
  const paths = new Set<string>(), merged = new Set<string>(), legacy = new Set<string>();
  const visit = (node: MemoryIndexNode, ancestors: string[]) => {
    const parts = [...ancestors, node.name], path = memoryNodePath(parts);
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
      CREATE TABLE IF NOT EXISTS memory_purpose_documents(purpose_id TEXT PRIMARY KEY REFERENCES memory_purposes(id) ON DELETE CASCADE,body TEXT NOT NULL);`);
  }
  initialized(workspaceId: string) {
    return !!this.store.db.prepare("SELECT 1 FROM memory_node_indexes WHERE workspace_id=?").get(workspaceId);
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
    const tree = queryMemorySnapshot(input), report = preflightMemoryNodes(tree);
    const documents = new Map(tree.purposes.map(purpose => {
      const row = this.store.db.prepare("SELECT body FROM memory_purpose_documents WHERE purpose_id=?").get(purpose.id);
      return [purpose.id, row ? JSON.parse(String(row.body)) as MemoryDocumentRef[] : []] as const;
    }));
    const known = new Map(this.store.db.prepare("SELECT id,title_path FROM memory_directory_nodes WHERE workspace_id=?").all(workspaceId).map(row => [String(row.title_path), Number(row.id)]));
    type Draft = { id: number; name: string; parent: number; depth: number; ancestors: number[]; path: string; purposes: Set<string>; position: number };
    const drafts = new Map<string, Draft>();
    const visit = (node: MemoryIndexNode, titles: string[], ids: number[]) => {
      const parts = [...titles, node.name], path = memoryNodePath(parts);
      let draft = drafts.get(path);
      if (!draft) {
        let id = known.get(path);
        if (id === undefined) {
          id = Number(this.store.db.prepare("UPDATE memory_node_sequence SET next_id=next_id+1 WHERE id=1 RETURNING next_id-1 AS id").get()!.id);
        }
        draft = { id, name: node.name, parent: ids.at(-1) ?? -1, depth: ids.length + 1, ancestors: ids, path, purposes: new Set(), position: drafts.size };
        drafts.set(path, draft);
      }
      for (const id of node.purposeIds ?? (node.purposeId ? [node.purposeId] : [])) draft.purposes.add(id);
      node.children.forEach(child => visit(child, parts, [...ids, draft!.id]));
    };
    tree.roots.forEach(node => visit(node, [], []));
    // Tombstones retain identities forever, including after removal/reordering.
    this.store.db.prepare("UPDATE memory_directory_nodes SET active=0 WHERE workspace_id=?").run(workspaceId);
    const save = this.store.db.prepare(`INSERT INTO memory_directory_nodes VALUES(?,?,?,?,?,?,?,?,?,?,1)
      ON CONFLICT(workspace_id,title_path) DO UPDATE SET title=excluded.title,parent_id=excluded.parent_id,depth=excluded.depth,
      ancestor_ids=excluded.ancestor_ids,purpose_ids=excluded.purpose_ids,document_refs=excluded.document_refs,position=excluded.position,active=1`);
    for (const draft of drafts.values()) {
      const ids = [...draft.purposes], refs = uniqueMemoryDocuments(ids.flatMap(id => documents.get(id) ?? []));
      save.run(draft.id, workspaceId, draft.name, draft.parent, draft.depth, JSON.stringify(draft.ancestors), draft.path, JSON.stringify(ids), JSON.stringify(refs), draft.position);
    }
    this.store.db.prepare("INSERT INTO memory_node_indexes VALUES(?,?,?) ON CONFLICT(workspace_id) DO UPDATE SET version=excluded.version,report=excluded.report")
      .run(workspaceId, tree.version, JSON.stringify(report));
  }
  snapshot(workspaceId: string, legacy: MemoryTree): MemoryTree {
    const nodes = new Map<string, MemoryIndexNode>(), roots: MemoryIndexNode[] = [];
    for (const row of this.store.db.prepare("SELECT * FROM memory_directory_nodes WHERE workspace_id=? AND active=1 ORDER BY position").all(workspaceId)) {
      const node: MemoryIndexNode = { id: String(row.id), name: String(row.title), titlePath: String(row.title_path), parentId: String(row.parent_id),
        depth: Number(row.depth), ancestorIds: (JSON.parse(String(row.ancestor_ids)) as number[]).map(String),
        purposeIds: JSON.parse(String(row.purpose_ids)), documentRefs: JSON.parse(String(row.document_refs)), children: [] };
      nodes.set(node.id, node);
      if (node.parentId === "-1") roots.push(node);
      else {
        const parent = nodes.get(node.parentId!);
        if (!parent) throw Error("记忆节点父级缺失");
        parent.children.push(node);
      }
    }
    return { ...queryMemorySnapshot(legacy), roots };
  }
}
