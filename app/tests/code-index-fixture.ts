import { mkdtemp, mkdir, writeFile, rm, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { TestContext } from "node:test";
import type { IndexProposal, NodeProposal, RequestLedger, SubmissionOwner } from "../src/server/code-index/contracts.js";
import { FilePolicy, type FilePolicyOptions } from "../src/server/code-index/source/policy.js";
import { SourceEvidence } from "../src/server/code-index/source/evidence.js";
import { SqliteIndexStore } from "../src/server/code-index/store/sqlite.js";
import { CommitCoordinator } from "../src/server/code-index/application/commit.js";

export async function indexFixture(t: TestContext, options: FilePolicyOptions = {}) {
  const directory = await realpath(await mkdtemp(path.join(tmpdir(), "axiom-index-store-"))), root = path.join(directory, "workspace");
  await mkdir(root);
  const policy = await FilePolicy.create(root, options), filename = path.join(directory, "private", "index.sqlite");
  const store = new SqliteIndexStore(filename, "test-index"), sources = new SourceEvidence(store, policy, "workspace"), commits = new CommitCoordinator(store, sources);
  const owner: SubmissionOwner = { indexKey: "test-index", workspaceId: "workspace", purpose: "locate", sessionId: "session", runId: "run", jobId: null };
  t.after(async () => { sources.close(); store.close(); await rm(directory, { recursive: true, force: true }); });
  const put = async (name: string, text: string) => { await mkdir(path.dirname(path.join(root, name)), { recursive: true }); await writeFile(path.join(root, name), text); };
  const ledger = (requestId = "request", attemptId = "attempt") => sources.createLedger(requestId, attemptId, owner, Date.now() + 60_000);
  const read = async (ledger: RequestLedger, name = "a.ts", endLine = 1) => {
    const result = await sources.read(ledger.ledgerId, { operations: [{ kind: "read", path: name, startLine: 0, endLine }] });
    const record = result.operations[0].evidence[0];
    if (!record?.source) throw new Error(JSON.stringify(result));
    return record;
  };
  return { directory, root, filename, policy, store, sources, commits, owner, put, ledger, read };
}
export function implementation(id: string, evidenceId: string, name = "Double"): NodeProposal {
  return { id, kind: "implementation", expectedContentRev: null, expectedRecordRev: null, name, summary: "将输入乘以二。", aliases: [], facts: [{ kind: "action", assertion: "observed", text: "返回输入乘以二。", evidenceIds: [evidenceId] }], boundary: { includes: "数值输入", excludes: [] }, unknowns: [], coverage: { mode: "partial", scopeIds: [], gaps: [] } };
}
export function proposal(ledger: RequestLedger, nodes: NodeProposal[] = []): IndexProposal {
  return { version: "index-proposal/1", requestId: ledger.requestId, nodes, edges: [], reviews: [], retire: [], reactivate: [], result: { status: "partial", selection: { objectIds: nodes.map(node => node.id), locations: [], featurePaths: [], knowledgeIds: [] }, searchedScopeIds: [], coverage: { mode: "partial", scopeIds: [], gaps: [] } } };
}
