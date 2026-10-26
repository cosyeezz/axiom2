import { useId } from "react";
import { agentScope, emptyAgent, emptyThread, messageScope, running, threadScope, type ChatMessage, type ThreadIndex } from "../../shared/agent.js";
import { emptyTasks, taskActive, tasksScope } from "../../shared/tasks.js";
import { modelQuestionsReply, parseModelQuestions, questionAnswered, questionIsCurrent, questionMessageComplete, type ModelQuestion } from "../../shared/model-question.js";
import type { Configuration, Scope } from "../../shared/protocol.js";
import { scopeCurrent, scopeSnapshot, useConnectionState, useScope } from "../transport.js";
import { Icon } from "../Icon.js";
import { getComposerEdit, useComposerEditRevision } from "./composer-edit.js";
import { pendingMessages, useOptimistic } from "./optimistic.js";
import { useSubmission } from "./useSubmission.js";
import { useQuestionState } from "./question-state.js";
import "../styles/model-question.css";

const noConfig: Configuration = { revision: "", providerCount: 0, modelCount: 0, available: [], dataRoot: "" };
export const questionStateKey = (scope: Scope, messageId: string, questions: ModelQuestion[]) => JSON.stringify([scope.workspaceId, scope.sessionId, messageId, questions]);
export function ModelQuestionCard({ scope, messageId, questions, enabled = false }: {
  scope: Scope; messageId: string; questions: ModelQuestion[]; enabled?: boolean;
}) {
  const id = useId();
  const [state, update] = useQuestionState(questionStateKey(scope, messageId, questions), questions.length);
  const index = useScope(threadScope(scope), emptyThread);
  const info = useScope(agentScope(scope), emptyAgent);
  const nested = !!info.task;
  const tasks = useScope(nested ? null : tasksScope(scope), emptyTasks);
  const config = useScope("configuration", noConfig);
  const { connected } = useConnectionState();
  const pending = useOptimistic(scope);
  useComposerEditRevision(scope);
  const active = nested ? info.task ? taskActive(info.task.status) : running(info.run)
    : running(info.run) || tasks.tasks.some(task => taskActive(task.status));
  const selected = config.available.some(model => model.provider === info.selection?.provider && model.id === info.selection.id);
  const { busy, error, submit } = useSubmission(scope, { active, nested, selected, connected, runId: info.run?.id, task: info.task });
  const current = enabled && questionIsCurrent(messageId, index);
  const pendingReply = pending.some(item => item.state !== "failed");
  const disabled = !current || active || !connected || !selected || busy || state.submitted || pendingReply || !!getComposerEdit(scope);
  const text = modelQuestionsReply(questions, state.answers);
  const answered = questions.filter((q, i) => questionAnswered(q, state.answers[i])).length;
  const answer = (position: number, change: Partial<typeof state.answers[number]>) => update({ answers: state.answers.map((a, i) => i === position ? { ...a, ...change } : a) });
  return <form className="model-question" aria-label="模型提问" onSubmit={event => {
    event.preventDefault();
    // Recheck authoritative snapshots; optimisticStart is synchronous, so the
    // first submission also closes the gate for other mounted copies.
    const latest = scopeSnapshot<ThreadIndex>(threadScope(scope));
    const agent = scopeSnapshot<typeof info>(agentScope(scope));
    const children = scopeSnapshot<typeof tasks>(tasksScope(scope));
    const source = scopeSnapshot<ChatMessage>(messageScope(scope, messageId));
    if (!source || !questionMessageComplete(source) ||
      JSON.stringify(parseModelQuestions(source.text)?.questions) !== JSON.stringify(questions)) return;
    if (disabled || !text || !latest || !scopeCurrent(threadScope(scope)) || !scopeCurrent(agentScope(scope)) ||
      !scopeCurrent(messageScope(scope, messageId)) || !scopeCurrent("configuration") ||
      !nested && !scopeCurrent(tasksScope(scope)) || !questionIsCurrent(messageId, latest) ||
      running(agent?.run ?? null) || agent?.task && taskActive(agent.task.status) ||
      !nested && children?.tasks.some(task => taskActive(task.status)) ||
      pendingMessages(scope).some(item => item.state !== "failed") || getComposerEdit(scope)) return;
    void submit("prompt", { draft: { text, attachment: null }, onStart: () => update({ submitted: true }) });
  }}>
    <div className="model-question-body">
    {questions.map((question, position) => <fieldset key={position} disabled={disabled} data-answered={questionAnswered(question, state.answers[position]) || undefined}>
      <legend><span className="model-question-number" aria-hidden="true">{String(position + 1).padStart(2, "0")}</span><span className="model-question-caption"><span className="model-question-title">{question.question}</span><span className="model-question-hint">{question.type === "single" ? "单选" : "多选"}</span></span></legend>
      <div className="model-question-content">
      <div className="model-question-options">{question.options.map((option, choice) => {
        const checked = state.answers[position].selected.includes(choice);
        return <label key={choice} className="model-question-option" data-selected={checked || undefined}>
          <input type={question.type === "single" ? "radio" : "checkbox"} name={`${id}-${position}`} aria-describedby={question.descriptions?.[choice] ? `${id}-${position}-${choice}-description` : undefined} checked={checked} onChange={() => answer(position, { selected: question.type === "single" ? [choice] : checked ? state.answers[position].selected.filter(i => i !== choice) : [...state.answers[position].selected, choice] })} />
          <span className="model-question-mark" aria-hidden="true">{checked && question.type === "multiple" && <Icon name="check" />}</span><span className="model-question-label">{option}</span>
        </label>;
      })}</div>
      {question.descriptions?.some(Boolean) && <details className="model-question-details" open={state.expanded[position]} onToggle={event => {
        const open = event.currentTarget.open;
        if (open !== state.expanded[position]) update({ expanded: state.expanded.map((value, i) => i === position ? open : value) });
      }}>
        <summary><Icon name="chevron-right" />选项说明</summary>
        <dl>{question.options.map((option, choice) => question.descriptions?.[choice] ? <div key={choice} data-selected={state.answers[position].selected.includes(choice) || undefined}>
          <dt>{option}</dt><dd id={`${id}-${position}-${choice}-description`}>{question.descriptions[choice]}</dd>
        </div> : null)}</dl>
      </details>}
      <div className="model-question-custom">
        <div className="model-question-custom-heading">
          <label htmlFor={`${id}-${position}-custom`}><span className="screen-reader">{question.question}：</span>其他答案或补充<span className="model-question-optional" aria-hidden="true">选填</span></label>
          {state.answers[position].selected.length > 0 && !disabled && <button type="button" onClick={() => answer(position, { selected: [] })}>清除选择</button>}
        </div>
        <textarea id={`${id}-${position}-custom`} value={state.answers[position].text} maxLength={4000} rows={1} placeholder="也可以直接输入你的回答…" onChange={event => answer(position, { text: event.target.value })} />
      </div>
      </div>
    </fieldset>)}
    </div>
    <footer className="model-question-footer">
      {current && <div className="model-question-actions">
        <div className="model-question-progress" aria-live="polite" aria-atomic="true">
          <span className="model-question-progress-track" aria-hidden="true"><span style={{ width: `${answered / questions.length * 100}%` }} /></span>
          <span><strong>{answered}</strong> / {questions.length} 已回答</span>
        </div>
        <button type="submit" className="btn btn-primary" disabled={disabled || !text}><span>{busy ? "正在发送…" : state.submitted ? "已交给发送队列" : "发送回答"}</span><Icon name="arrow-up" /></button>
      </div>}
      <p className="model-question-status" role="status">{state.submitted ? "回答已交给发送队列；如发送失败，可在下方恢复。结果未确认时不会重复发送。" : !current ? "历史提问，仅供查看。" :
        !connected ? "连接后可回复。" : active ? "会话仍在执行，结束后可回复。" : pendingReply ? "正在确认已发送的消息，请勿重复提交。" :
        !selected ? "请先选择可用模型。" : getComposerEdit(scope) ? "请先完成或取消消息编辑。" : null}</p>
      {error && <p className="execution-alert" role="alert">{error}</p>}
    </footer>
  </form>;
}
