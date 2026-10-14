import type { ChatMessage } from "../../shared/agent.js";
import { NotificationIcon } from "../NotificationIcon.js";
import "../styles/task-notice.css";

/** Quiet inline system feedback, not an assistant reply or an actionable task card. */
export function TaskNotice({ message }: { message: ChatMessage }) {
  const state = message.taskNotice ?? "unknown";
  return <div className="task-notice" data-result-id={message.resultId} data-state={state} role="status" aria-atomic="true">
    <span className="task-notice-icon" aria-hidden="true">
      <NotificationIcon error={state === "failed" || state === "interrupted"} />
    </span>
    <span className="task-notice-text">{message.text.trimEnd().replace(/[!！]+$/, "")}！</span>
    <span className="task-notice-rule" aria-hidden="true" />
  </div>;
}
