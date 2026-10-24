import { createHash } from "node:crypto";
import type { SessionManager } from "@earendil-works/pi-coding-agent";
import type { ChatMessage } from "../shared/agent.js";
import type { HistoryGroup, HistoryIndex } from "../shared/history.js";
import { threadGroups } from "../shared/thread-layout.js";
import { toolSummary } from "../shared/tool-summary.js";
import { chatMessage, transcriptEntries } from "./transcript.js";
import { compactionDisplay } from "./compaction-display.js";

export interface HistoryProjection {
  index: HistoryIndex;
  messages: Map<string, ChatMessage>;
  bytes: number;
}
/** Physical compaction events delimit disjoint UI ranges, independently of model keep boundaries. */
export function historyProjection(manager: SessionManager, _source: string): HistoryProjection {
  const branch = manager.getBranch();
  const positions = new Map(branch.map((entry, i) => [entry.id, i]));
  const checkpoints = branch.filter(entry => entry.type === "compaction");
  const buckets: ChatMessage[][] = checkpoints.map(() => []);
  const messages = new Map<string, ChatMessage>();
  let bucket = 0;
  for (const entry of transcriptEntries(manager, true)) {
    const position = positions.get(entry.entryId)!;
    while (bucket < checkpoints.length && positions.get(checkpoints[bucket].id)! < position) bucket++;
    const message = chatMessage(entry.message, entry.id);
    if (!message) continue;
    messages.set(message.id, message);
    if (bucket < buckets.length) buckets[bucket].push(message);
  }
  const digest = (ids: string[]) => {
    const hash = createHash("sha256"), related = new Set(ids);
    for (const id of ids) for (const call of messages.get(id)?.calls ?? []) related.add(`tool-${call.id}`);
    for (const id of related) hash.update(JSON.stringify(messages.get(id) ?? null));
    return hash.digest("hex").slice(0, 24);
  };
  const segments = checkpoints.map((checkpoint, i) => {
    const compression = compactionDisplay(checkpoint, branch);
    messages.set(checkpoint.id, { id: checkpoint.id, role: "notice", text: checkpoint.summary, compression });
    const groups: HistoryGroup[] = threadGroups(buckets[i], { archived: true }).map(group => {
      const items = group.ids.map(id => messages.get(id)!);
      const last = items.filter(item => item.role === "assistant").at(-1);
      const calls = items.flatMap(item => item.calls ?? []);
      const latest = calls.at(-1);
      const latestSummary = latest && toolSummary(latest);
      // A compaction can interrupt a run before final_answer. These archived
      // activities are still completed history, not live process fragments.
      // Leave ordinary prose boundaries intact.
      const folded = group.folded || group.activity && items.some(item => item.role === "assistant");
      return { ...group, ...(folded ? { folded: true } : {}), revision: digest(group.ids), estimatedHeight: folded ? group.folded ? 82 : 36 : group.activity ? 60 : Math.min(680, 92 + Math.ceil((items[0]?.text.length ?? 0) / 75) * 24),
        ...(folded ? { process: {
          status: last?.error || last?.status === "failed" ? "failed" as const : last?.status === "cancelled" ? "cancelled" as const : "completed" as const,
          calls: calls.length,
          inline: !group.folded,
          failed: calls.filter(call => messages.get(`tool-${call.id}`)?.status === "failed").length,
          succeeded: calls.filter(call => messages.get(`tool-${call.id}`)?.status === "completed").length,
          ...(latest && latestSummary ? { latest: { name: latestSummary.label, icon: latestSummary.icon,
            target: `${latestSummary.target}${latestSummary.detail ? ` · ${latestSummary.detail}` : ""}`.slice(0, 160),
            status: messages.get(`tool-${latest.id}`)?.status === "failed" ? "failed" as const : messages.get(`tool-${latest.id}`)?.status === "completed" ? "completed" as const : "unknown" as const } } : {}),
          preview: latestSummary ? `${latestSummary.label} · ${latestSummary.target}`.slice(0, 160) : "思考与任务记录",
        } } : {}),
      };
    });
    return { id: checkpoint.id, revision: digest([checkpoint.id]), compression, messageIds: buckets[i].map(message => message.id), groups };
  });
  const bytes = [...messages.values()].reduce((total, message) => total + 256 + 2 * (message.text.length + (message.thinking?.length ?? 0) +
    (message.calls?.reduce((sum, call) => sum + call.input.length, 0) ?? 0)), 0);
  // Current streaming appends must not invalidate an unchanged archive snapshot.
  const revision = createHash("sha256").update(JSON.stringify(segments));
  const archived = new Set(segments.flatMap(segment => [segment.id, ...segment.messageIds]));
  for (const id of [...archived]) for (const call of messages.get(id)?.calls ?? []) archived.add(`tool-${call.id}`);
  for (const id of archived) revision.update(JSON.stringify(messages.get(id) ?? null));
  return { index: { revision: revision.digest("hex"), segments }, messages, bytes };
}
