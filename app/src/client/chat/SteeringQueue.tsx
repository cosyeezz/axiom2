import { useScope } from "../transport.js";
import { agentScope, emptyAgent } from "../../shared/agent.js";
import type { Scope } from "../../shared/protocol.js";
import { SkillCards } from "./SkillCards.js";
import { RestoreSubmission } from "./RestoreSubmission.js";
import { pendingMessageStatus, useOptimistic } from "./optimistic.js";

export function SteeringQueue({ scope, nested = false }: { scope: Scope; nested?: boolean }) {
  const info = useScope(agentScope(scope), emptyAgent);
  const pending = useOptimistic(scope).filter((item) => item.queued);
  const queue = info.queue ?? [];
  if (!queue.length && !pending.length) return null;
  return <div className="steering-queue" aria-label="待执行消息" data-tooltip="在输入框内双击 Esc 撤回排队内容并编辑">
    {queue.map((item) => {
      const local = pending.find((entry) => entry.id === item.id || entry.inputId === item.id);
      return <div className="steering-queue-item" key={item.id}>
        <span>{item.mode === "followUp" ? "Follow-up" : "Steering"}</span>
        <span data-tooltip={item.text}>{item.text}</span>
        <SkillCards skills={item.skills} scope={scope} compact />
        {local?.confirmation && <small role="status">{pendingMessageStatus(local, true)}</small>}
      </div>;
    })}
    {pending.filter((item) => !queue.some((entry) => entry.id === item.id || entry.id === item.inputId)).map((item) =>
      <div className="steering-queue-item" data-failed={item.state === "failed" || undefined} key={item.id}>
        <span>Steering</span>
        <span>{item.draft.text || (item.draft.skills?.length ? "" : "附件消息")}{(item.draft.attachments ?? []).map((a) => ` · ${a.name}`).join("")}</span>
        <SkillCards skills={item.draft.skills} scope={scope} compact />
        <small role="status">{pendingMessageStatus(item, true)}</small>
        {item.state === "failed" && <RestoreSubmission scope={scope} id={item.id} nested={nested} />}
      </div>)}
  </div>;
}
