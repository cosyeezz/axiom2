import { useConnectionState, useScope } from "../transport.js";
import { Icon } from "../components.js";
import type { Configuration, Scope } from "../../shared/protocol.js";
import { agentScope, emptyAgent, running } from "../../shared/agent.js";
import { emptyTasks, taskActive, tasksScope } from "../../shared/tasks.js";
import { canContinue } from "../../shared/session-state.js";
import { useOptimistic } from "./optimistic.js";
import { useSubmission } from "./useSubmission.js";
import { useResumeAttempt } from "./resume-state.js";

const noConfig: Configuration = { revision: "", providerCount: 0, modelCount: 0, available: [], dataRoot: "" };
export function RetryAction({ scope, nested }: { scope: Scope; nested: boolean }) {
  const info = useScope(agentScope(scope), emptyAgent);
  const tasks = useScope(nested ? null : tasksScope(scope), emptyTasks);
  const config = useScope("configuration", noConfig);
  const { connected } = useConnectionState();
  const pending = useOptimistic(scope);
  const attempt = useResumeAttempt(scope);
  const active = nested ? info.task ? taskActive(info.task.status) : running(info.run)
    : running(info.run) || tasks.tasks.some((task) => taskActive(task.status));
  const selected = config.available.some((model) => model.provider === info.selection?.provider && model.id === info.selection.id);
  const { busy, submit } = useSubmission(scope, { active, nested, selected, connected, runId: info.run?.id, task: info.task });
  const submitting = pending.some((item) => item.state !== "failed");
  if (active || !canContinue(info.run) || submitting || attempt &&
    (attempt.expectedRunId === info.run?.id || !attempt.expectedRunId && !attempt.accepted)) return null;
  return <div className="thread-tail-actions">
    <button type="button" className="icon-btn retry-action" aria-label="重试"
      data-tooltip={!connected ? "连接后可重试" : !selected ? "请先选择可用模型" : "从中断处重试"}
      disabled={busy || !connected || !selected}
      onClick={(event) => {
        const keyboard = event.detail === 0;
        void submit("continue");
        if (keyboard) document.getElementById(nested ? `prompt-${scope.sessionId}` : "prompt")?.focus({ preventScroll: true });
      }}>
      <Icon name="rotate-cw" />
    </button>
  </div>;
}
