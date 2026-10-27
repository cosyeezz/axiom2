import { agentScope, emptyAgent, running } from "../../shared/agent.js";
import type { Scope } from "../../shared/protocol.js";
import { useScope } from "../transport.js";
import { pendingMessageStatus, useOptimistic } from "./optimistic.js";
import { RestoreSubmission } from "./RestoreSubmission.js";
import "../styles/submission-feedback.css";

// Sending/accepted are represented by the shared process indicator, never a
// footer on a user message. Exceptional outcomes stay beside their own composer.
export function SubmissionFeedback({ scope, nested = false }: { scope: Scope; nested?: boolean }) {
  const info = useScope(agentScope(scope), emptyAgent);
  const pending = useOptimistic(scope).filter(item => !item.queued &&
    (item.state === "failed" || item.state === "uncertain" || !!item.confirmation));
  if (!pending.length) return null;
  return <div className="submission-feedback" aria-label="发送反馈">
    {pending.map(item => <div className="submission-feedback-item" key={item.id} data-tooltip={item.draft.text}>
      <p role={item.state === "failed" ? "alert" : "status"}>{pendingMessageStatus(item)}</p>
      {(item.state === "failed" || item.state === "uncertain" && !running(info.run)) &&
        <RestoreSubmission scope={scope} id={item.id} nested={nested} uncertain={item.state === "uncertain"} />}
    </div>)}
  </div>;
}
