import { randomUUID } from "node:crypto";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "./temporary.js";
import { Store } from "../src/server/storage.js";
import { Memories, type MemoryExecution } from "../src/server/memories.js";
import { memoryDirectory, digest } from "../src/server/memory-files.js";
import { memoryDetails } from "../src/shared/memory-detail-paths.js";
import { memoryBatchWaitMs } from "../src/shared/memory-tree.js";
import type { Scope, Session, Workspace } from "../src/shared/protocol.js";
export const selection = { provider: "fixture", id: "fixture", thinking: "off" as const };
export const classification = (input: Pick<MemoryExecution, "prompt">, name = "记忆事务") => ({ answer: JSON.stringify([{ name, children: JSON.parse(input.prompt).purposes.map((p: { id: string }) => ({ purposeId: p.id })) }]), incomplete: false });
/** Independently decode the model-facing protocol for fake semantic selections. */
export const matchingCandidates = (input: Pick<MemoryExecution, "prompt">) => {
  const data = JSON.parse(input.prompt);
  if (typeof data.catalog !== "string") return undefined;
  assertCatalogPrefix(data.catalog);
  const lines: string[] = data.catalog.split("\n").slice(1), stack: string[] = [];
  return lines.filter(Boolean).map((line, index) => {
    const depth = (line.length - line.trimStart().length) / 2, text = line.trimStart();
    stack.length = depth; stack.push(text);
    const next = lines[index + 1];
    return { id: stack.join(" / "), text, kind: next && next.length - next.trimStart().length > depth * 2 ? "directory" : "purpose" };
  });
};
function assertCatalogPrefix(catalog: string) {
  if (!catalog.startsWith("目录：\n")) throw Error("fixture expected a complete plain-text directory");
}
export const navigation = (input: Pick<MemoryExecution, "prompt">, answer = "原文验证通过") => {
  const candidates = matchingCandidates(input);
  return { answer: candidates ? JSON.stringify(candidates.map(c => c.id)) : answer, incomplete: false };
};
/** All fixtures use disposable storage, explicit batch driving and no business models. */
export function purposeFixture() {
  const root = mkdtempSync(join(tmpdir(), "axiom-purpose-")), project = join(root, "project"); mkdirSync(project);
  const store = new Store(root), workspace = store.execute({ requestId: randomUUID(), op: "workspace.open", params: { path: project, authorized: true } }) as Workspace;
  const memories = new Memories(store, () => {});
  clearInterval((memories as any).timer); (memories as any).watcher?.close();
  (memories as any).scheduleOrganization = () => {};
  const tree = memories.pipeline.tree;
  const create = (content = "# [Completed] 验证目的\n## [Completed] 验证结果\n") => {
    const session = store.execute({ requestId: randomUUID(), op: "session.create", workspaceId: workspace.id }) as Session;
    const scope = { workspaceId: workspace.id, sessionId: session.id };
    writeFileSync(join(memoryDirectory(root, session.id), "MEMORY.md"), content); return scope;
  };
  const write = (scope: Scope, content: string) => writeFileSync(join(memoryDirectory(root, scope.sessionId), "MEMORY.md"), content);
  const detail = (scope: Scope, content: string, anchor?: string) => {
    const entry = join(memoryDirectory(root, scope.sessionId), "MEMORY.md"), text = readFileSync(entry, "utf8");
    const line = anchor ? text.split(/\r?\n/).indexOf(anchor) : 0;
    const detail = memoryDetails(text).find(detail => detail.node.line === line);
    if (!detail) throw Error("fixture anchor not found");
    const path = join(memoryDirectory(root, scope.sessionId), detail.path); mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, content);
    return { path: detail.path };
  };
  const configure = (params: Record<string, unknown>) => memories.command({ requestId: randomUUID(), op: "memory.configure", workspaceId: workspace.id, params });
  const publish = (name = "记忆事务") => {
    const batch = tree.batch(workspace.id, Date.now() + memoryBatchWaitMs), old = tree.snapshot(workspace.id);
    const purposes = [...old.purposes, ...batch];
    const roots = tree.classify(JSON.stringify([{ name, children: purposes.map(p => ({ purposeId: p.id })) }]), purposes);
    tree.publish(workspace.id, batch, roots, old.version); return batch;
  };
  return { root, project, store, workspace, memories, tree, create, write, detail, configure, publish,
    async close() { await memories.close(); store.close(); rmSync(root, { recursive: true, force: true }); } };
}
