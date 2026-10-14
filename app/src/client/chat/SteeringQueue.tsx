import { useScope } from "../transport.js";
import { agentScope, emptyAgent } from "../../shared/agent.js";
import type { Scope } from "../../shared/protocol.js";
import { useOptimistic } from "./optimistic.js";

export function SteeringQueue({ scope }: { scope: Scope }) {
  const info = useScope(agentScope(scope), emptyAgent);
  const pending = useOptimistic(scope).filter((item) => item.queued);
  const queue = info.queue ?? [];
  if (!queue.length && !pending.length) return null;
  return <div className="steering-queue" aria-label="待执行消息" title="在输入框内双击 Esc 撤回排队内容并编辑">
    {queue.map((item) => <div className="steering-queue-item" key={item.id}>
      <span>{item.mode === "followUp" ? "Follow-up" : "Steering"}</span>
      <span title={item.text}>{item.text}</span>
    </div>)}
    {pending.filter((item) => !queue.some((entry) => entry.id === item.id || entry.id === item.inputId)).map((item) =>
      <div className="steering-queue-item" key={item.id}>
        <span>Steering</span>
        <span>{item.draft.text || "附件消息"}{(item.draft.attachments ?? []).map((a) => ` · ${a.name}`).join("")}</span>
        <small role="status">{{ sending: "正在排队…", accepted: "等待接收", uncertain: "正在确认发送结果…" }[item.state]}</small>
      </div>)}
  </div>;
}
