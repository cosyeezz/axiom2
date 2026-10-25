import { useId, useLayoutEffect, useMemo, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { agentScope, emptyAgent, emptyThread, messageScope, threadScope, type ChatMessage } from "../../shared/agent.js";
import { tasksScope } from "../../shared/tasks.js";
import { parseModelQuestions, questionIsCurrent, questionMessageComplete, type ModelQuestion } from "../../shared/model-question.js";
import type { Scope } from "../../shared/protocol.js";
import { openPopover, popoverHost } from "../popover.js";
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
  return <QuestionPrompt key={key} scope={scope} anchor={anchor} messageId={messageId} questions={parsed.questions} />;
}

function QuestionPrompt({ scope, anchor, messageId, questions }: { scope: Scope; anchor: HTMLFormElement; messageId: string; questions: ModelQuestion[] }) {
  const [state] = useQuestionState(questionStateKey(scope, messageId, questions), questions.length);
  const id = useId();
  if (state.submitted) return null;
  return <QuestionPopover id={id} anchor={anchor}>
    <ModelQuestionCard scope={scope} messageId={messageId} questions={questions} enabled />
  </QuestionPopover>;
}

function QuestionPopover({ id, anchor, children }: { id: string; anchor: HTMLFormElement; children: ReactNode }) {
  const panel = useRef<HTMLDivElement>(null);
  const host = popoverHost(anchor);
  useLayoutEffect(() => {
    const node = panel.current!;
    const area = anchor.closest(".composer-area")!;
    const position = () => {
      const viewport = window.visualViewport;
      const top = viewport?.offsetTop ?? 0, left = viewport?.offsetLeft ?? 0;
      const width = viewport?.width ?? window.innerWidth;
      const rect = anchor.getBoundingClientRect();
      const bottom = Math.min(rect.top - 8, top + (viewport?.height ?? window.innerHeight) - 8);
      const panelWidth = Math.max(0, Math.min(rect.width, width - 24));
      node.style.left = `${Math.max(left + 12, Math.min(rect.left, left + width - panelWidth - 12))}px`;
      node.style.bottom = `${window.innerHeight - bottom}px`;
      node.style.width = `${panelWidth}px`;
      node.style.maxHeight = `${Math.max(0, bottom - top - 12)}px`;
    };
    const restoreFocus = () => {
      if (node.contains(document.activeElement) && anchor.isConnected) anchor.querySelector<HTMLTextAreaElement>("textarea")?.focus({ preventScroll: true });
    };
    let frame = 0;
    const schedule = (event?: Event) => {
      if (event?.target instanceof Node && node.contains(event.target)) return;
      if (!frame) frame = requestAnimationFrame(() => { frame = 0; position(); });
    };
    position();
    // No extra entry or close control: keep unanswered questions accessible while
    // typing outside the panel. Auto-open never interrupts the Composer's focus.
    const dispose = openPopover(node, { source: anchor });
    const observer = new ResizeObserver(() => schedule());
    observer.observe(area); observer.observe(anchor); observer.observe(host);
    window.addEventListener("resize", position);
    window.addEventListener("scroll", schedule, true);
    window.visualViewport?.addEventListener("resize", position);
    window.visualViewport?.addEventListener("scroll", schedule);
    return () => {
      cancelAnimationFrame(frame); observer.disconnect();
      window.removeEventListener("resize", position);
      window.removeEventListener("scroll", schedule, true);
      window.visualViewport?.removeEventListener("resize", position);
      window.visualViewport?.removeEventListener("scroll", schedule);
      restoreFocus(); dispose();
    };
  }, [anchor, host]);
  return createPortal(<div ref={panel} id={id} className="model-question-popover" popover="manual" role="dialog" aria-label="模型提问">{children}</div>, host);
}
