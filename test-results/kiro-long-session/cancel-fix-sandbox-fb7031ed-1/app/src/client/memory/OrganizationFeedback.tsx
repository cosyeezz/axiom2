import type { MemoryTree } from "../../shared/memory-tree.js";
import type { ProcessingOpening } from "../pages/ProcessingPage.js";
import { useProcessingList } from "../processing/records.js";
import { ProcessingDisclosure, processingTime } from "../processing/ProcessDetail.js";

/** Queue facts come from the original purpose queue; records only describe its work. */
export function OrganizationFeedback({ workspaceId, tree, openRecords }: { workspaceId: string; tree: (MemoryTree & { unavailable?: boolean }) | null; openRecords: (initial: ProcessingOpening) => void }) {
  const read = useProcessingList(tree && !tree.unavailable ? workspaceId : null, { kind: "memory.organize" });
  const queue = tree?.queue, active = tree?.activeBatch;
  const item = active ? read.data?.items.find(item => item.id === active.processingId) : read.data?.items[0];
  if (tree?.unavailable) return <p className="meta" role="status">记忆整理状态暂不可用，请检查工作空间授权。</p>;
  return <div className="memory-organization-feedback" aria-label="后台记忆整理">
    {queue && !!queue.waiting && <div className="memory-queue-summary" role="status"><strong>后续等待 {queue.waiting} 个目的</strong><span>可整理 {queue.eligible} · 退避 {queue.backoff} · 等待来源修复 {queue.blocked}</span>{queue.nextBatchAt != null && <span>最早满足批次条件：{processingTime(queue.nextBatchAt)}{active ? "；当前批次结束后再调度" : ""}</span>}{queue.retryAt != null && <span>退避到期：{processingTime(queue.retryAt)}</span>}<small>达到 50 个目的或最早目的等待 30 分钟后调度；查看不会提前启动。</small></div>}
    {active && <p role="status">正在整理 {active.purposeIds.length} 个目的 · 来自 {active.sessionIds.length} 个会话。新到目的留在后续队列，本批次尚未发布。</p>}
    {read.stale && tree && <p className="meta" role="status">正在恢复记录连接，以下为上次读取状态。</p>}{read.error && <p role="alert">{read.error}</p>}
    {item && <div className="memory-batch-feedback"><small>{active ? "当前批次" : "最近一次整理"}</small><ProcessingDisclosure workspaceId={workspaceId} item={item} /><button className="memory-text-button" onClick={() => openRecords({ kind: "memory.organize" })}>全部整理记录</button></div>}
  </div>;
}
