import type { Scope } from "../../shared/protocol.js";
import { processingOutcomes } from "../../shared/processing.js";
import { useProcessingList } from "../processing/records.js";
import { ProcessingDisclosure } from "../processing/ProcessDetail.js";

function useQueryRecord(scope: Scope, toolCallId: string, enabled = true) {
  return useProcessingList(enabled ? scope.workspaceId : null, { kind: "memory.query", sessionId: scope.sessionId, toolCallId });
}
/** This is a label inside the original tool row, not a separate execution/card. */
export function MemoryQueryStage({ scope, toolCallId, enabled }: { scope: Scope; toolCallId: string; enabled: boolean }) {
  const read = useQueryRecord(scope, toolCallId, enabled), item = read.data?.items[0];
  if (!item) return null;
  return <span className="memory-query-stage" data-state={item.state}>{read.stale ? "查询状态待确认" : item.error || `${item.stage}${item.outcome ? ` · ${processingOutcomes[item.outcome]}` : ""}`}</span>;
}
export function MemoryQueryFeedback({ scope, toolCallId }: { scope: Scope; toolCallId: string }) {
  const read = useQueryRecord(scope, toolCallId), item = read.data?.items[0];
  return <section className="memory-query-feedback" aria-label="记忆查询过程">{read.stale && <p className="meta" role="status">连接恢复中，暂不能确认查询状态。</p>}{read.error && <p role="alert">{read.error}</p>}{item ? <ProcessingDisclosure workspaceId={scope.workspaceId} item={item} /> : !read.loading && !read.error && <p className="meta">本次调用没有关联的处理记录；早期过程未作还原。</p>}</section>;
}
