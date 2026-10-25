import { useId, useMemo } from "react";
import { Icon } from "../components.js";
import { agentScope, emptyAgent, emptyThread, messageScope, threadScope, type ChatMessage } from "../../shared/agent.js";
import { tasksScope } from "../../shared/tasks.js";
import { parseModelQuestions, questionIsCurrent, questionMessageComplete, type ModelQuestion } from "../../shared/model-question.js";
import type { Scope } from "../../shared/protocol.js";
import { scopeCurrent, useConnectionState, useScope, useScopeOrder } from "../transport.js";
import { ModelQuestionCard, questionStateKey } from "./ModelQuestion.js";
import { useQuestionState } from "./question-state.js";

/** The live tail owns the prompt, not a virtualized (or historical) message row. */
export function ComposerQuestion({ scope, anchor, editing = false }: { scope: Scope; anchor: HTMLFormElement | null; editing?: boolean }) {
  const index = useScope(threadScope(scope), emptyThread);
  const messageId = index.ids.at(-1);
  const sourceScope = messageId ? messageScope(scope, messageId) : null;
  const message = useScope<ChatMessage | null>(sourceScope, null);
  const info = useScope(agentScope(scope), emptyAgent);
  const connection = useConnectionState();
  // Equal snapshots after reconnect still change authorization freshness.
  useScopeOrder(threadScope(scope));
  useScopeOrder(sourceScope);
  useScopeOrder(agentScope(scope));
  useScopeOrder("configuration");
  useScopeOrder(info.task ? null : tasksScope(scope));
  const parsed = useMemo(() => message && questionMessageComplete(message) ? parseModelQuestions(message.text) : null, [message]);
  if (!anchor || editing || !connection.connected || !messageId || !parsed || !questionIsCurrent(messageId, index) ||
    !sourceScope || !scopeCurrent(sourceScope) || !scopeCurrent(threadScope(scope)) || !scopeCurrent(agentScope(scope)) ||
    !scopeCurrent("configuration") || !info.task && !scopeCurrent(tasksScope(scope))) return null;
  const key = questionStateKey(scope, messageId, parsed.questions);
  return <QuestionPrompt key={key} scope={scope} messageId={messageId} questions={parsed.questions} />;
}

function QuestionPrompt({ scope, messageId, questions }: { scope: Scope; messageId: string; questions: ModelQuestion[] }) {
  const [state, update] = useQuestionState(questionStateKey(scope, messageId, questions), questions.length);
  const id = useId();
  if (state.submitted) return null;
  return <section className="model-question-dock" aria-label="模型提问">
    <button type="button" className="model-question-toggle" aria-expanded={!state.collapsed} aria-controls={id}
      onClick={() => update({ collapsed: !state.collapsed })}>
      <Icon name="chat" />
      <span>{state.collapsed && questions.length === 1 ? questions[0].question : `${questions.length} 个问题需要你确认`}</span>
      <span className="model-question-toggle-label">{state.collapsed ? "展开问题" : "收起问题"}</span>
      <Icon name="chevron" />
    </button>
    <div id={id} className="model-question-dock-content" hidden={state.collapsed}>
      <ModelQuestionCard scope={scope} messageId={messageId} questions={questions} enabled />
    </div>
  </section>;
}
