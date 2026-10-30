import { useScope } from "../transport.js";
import { agentScope, emptyAgent, running } from "../../shared/agent.js";
import type { Scope } from "../../shared/protocol.js";
import { SkillCards } from "./SkillCards.js";
import { RestoreSubmission } from "./RestoreSubmission.js";
import { pendingMessageStatus, useOptimistic } from "./optimistic.js";

export function SteeringQueue({ scope, nested = false, disabled = false, onRecall }: {
  scope: Scope; nested?: boolean; disabled?: boolean; onRecall: (inputId: string) => void;
}) {
  const info = useScope(agentScope(scope), emptyAgent);
  const pending = useOptimistic(scope).filter((item) => item.queued);
  const queue = info.queue ?? [];
  if (!queue.length && !pending.length) return null;
  return <div className="steering-queue" aria-label="待执行消息" data-tooltip="点击消息返回输入框编辑；在输入框内双击 Esc 撤回全部排队内容">
    {queue.map((item) => {
      const local = pending.find((entry) => entry.id === item.id || entry.inputId === item.id);
      return <div className="steering-queue-item" key={item.id}>
        <button type="button" className="steering-queue-recall" disabled={disabled}
          aria-label={`返回输入框编辑：${item.text || "附件消息"}`} onClick={() => onRecall(item.id)}>
          <span>{item.mode === "followUp" ? "Follow-up" : "Steering"}</span>
          <span data-tooltip={item.text}>{item.text || (item.skills?.length ? "" : "附件消息")}</span>
          {local?.confirmation && <small role="status">{pendingMessageStatus(local, true)}</small>}
        </button>
        <SkillCards skills={item.skills} scope={scope} compact />
      </div>;
    })}
    {pending.filter((item) => !queue.some((entry) => entry.id === item.id || entry.id === item.inputId)).map((item) => {
      const summary = <>
        <span>Steering</span>
        <span>{item.draft.text || (item.draft.skills?.length ? "" : "附件消息")}{(item.draft.attachments ?? []).map((a) => ` · ${a.name}`).join("")}</span>
        <small role="status">{pendingMessageStatus(item, true)}</small>
      </>;
      return <div className="steering-queue-item" data-failed={item.state === "failed" || item.state === "uncertain" || undefined} key={item.id}>
        {item.state === "accepted" ? <button type="button" className="steering-queue-recall" disabled={disabled}
          aria-label={`返回输入框编辑：${item.draft.text || "附件消息"}`} onClick={() => onRecall(item.inputId ?? item.id)}>
          {summary}
        </button> : summary}
        <SkillCards skills={item.draft.skills} scope={scope} compact />
        {(item.state === "failed" || item.state === "uncertain" && !running(info.run)) &&
          <RestoreSubmission scope={scope} id={item.id} nested={nested} uncertain={item.state === "uncertain"} />}
      </div>;
    })}
  </div>;
}
