import { useEffect, useRef, useState } from "react";
import { subscribeDisplaySettings } from "../display-settings.js";
import { FilePickerButton } from "../FilePicker.js";
import { useConnection, useConnectionState, useScope } from "../transport.js";
import { SkillCards } from "./SkillCards.js";
import { getDraft, useDraft, updateDraft } from "../drafts.js";
import { usePersistentDraft } from "../draft-persistence.js";
import { Icon } from "../components.js";
import { type Configuration, type Scope } from "../../shared/protocol.js";
import { agentScope, emptyAgent, running, type Selection } from "../../shared/agent.js";
import { tasksScope, emptyTasks, taskActive } from "../../shared/tasks.js";
import { ModelPicker } from "./ModelPicker.js";
import { Usage, type UsageTools } from "./Usage.js";
import { useSubmission } from "./useSubmission.js";
import { AttachmentList, AttachmentPicker } from "./Attachments.js";
import { AttachmentInputOverlay } from "./AttachmentInputOverlay.js";
import { useFileCompletion } from "./useFileCompletion.js";
import { AnnotationTray } from "./ReplyAnnotations.js";
import { clearSentAnnotations } from "./reply-annotations.js";
import { messageLengthError, messageTextLimit } from "./message-limit.js";
import { SteeringQueue } from "./SteeringQueue.js";
const noConfig: Configuration = {
  revision: "",
  providerCount: 0,
  modelCount: 0,
  available: [],
  dataRoot: "",
};
export function Composer({
  scope,
  nested = false,
  tools,
}: {
  scope: Scope;
  nested?: boolean;
  tools?: UsageTools;
}) {
  const info = useScope(agentScope(scope), emptyAgent),
    tasks = useScope(!nested ? tasksScope(scope) : null, emptyTasks),
    config = useScope("configuration", noConfig);
  const connected = useConnectionState().connected;
  const active = nested
      ? info.task
        ? taskActive(info.task.status)
        : running(info.run)
      : running(info.run) || tasks.tasks.some((t) => taskActive(t.status)),
    promptId = nested ? `prompt-${scope.sessionId}` : "prompt",
    selected = config.available.some(
      (m) =>
        m.provider === info.selection?.provider && m.id === info.selection.id,
    );
  usePersistentDraft(scope);
  const draft = useDraft(scope),
    input = useRef<HTMLTextAreaElement>(null);
  const [reading, setReading] = useState(false);
  const lastEscape = useRef<number | null>(null);
  useEffect(() => { lastEscape.current = null; }, [scope.workspaceId, scope.sessionId]);
  const completion = useFileCompletion(scope, draft.text, input);
  const hasContent = !!(draft.text.trim() || draft.attachment || draft.attachments?.length || draft.images?.length || draft.skills?.length);
  const lengthError = messageLengthError(draft.text);
  const imageSelection = running(info.run) ? info.run!.selection : info.selection;
  const imageModel = config.available.find(
    (m) => m.provider === imageSelection?.provider && m.id === imageSelection.id,
  );
  const imageUnsupported = !!draft.images?.length && !!imageModel && !imageModel.input?.includes("image");
  const { busy, error, setError, submit, recall } = useSubmission(
    scope,
    {
      active,
      nested,
      selected,
      connected,
      runId: info.run?.id,
      task: info.task,
    },
  );
  useEffect(() => {
    const node = input.current!;
    const resize = () => {
      const style = getComputedStyle(node);
      const scale = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--display-font-scale")) || 1;
      const minimum = parseFloat(style.minHeight) || 44 * scale;
      const maximum = parseFloat(style.maxHeight) || 180 * scale;
      node.style.setProperty("height", `${minimum}px`, "important");
      node.style.setProperty("height", `${Math.min(maximum, Math.max(minimum, node.scrollHeight))}px`, "important");
    };
    resize();
    let width = node.clientWidth;
    const observer = new ResizeObserver(() => {
      if (node.clientWidth === width) return;
      width = node.clientWidth;
      resize();
    });
    observer.observe(node);
    const unsubscribeDisplay = subscribeDisplaySettings(resize);
    return () => { observer.disconnect(); unsubscribeDisplay(); };
  }, [draft.text]);
  return (
    <section className="composer-area">
      <div className="container">
        <SteeringQueue scope={scope} nested={nested} />
        <AnnotationTray scope={scope} disabled={busy || !connected || (!active && !selected)}
          send={(items, text, supplement) => void submit(active ? "append" : "prompt", {
            draft: { text, attachment: null }, onStart: () => clearSentAnnotations(scope, items, supplement),
          })} />

        <div className="composer-resources" aria-label="技能与待发送附件">
          <SkillCards skills={draft.skills} scope={scope} onRemove={id => updateDraft(scope, { skills: getDraft(scope).skills?.filter(skill => skill.id !== id) })} />
          <AttachmentList scope={scope} draft={draft} reading={reading} />
        </div>
        <form
          className="composer"
          onSubmit={(e) => {
            e.preventDefault();
            if (active) void submit("stop");
            else if (!reading && !imageUnsupported && hasContent) void submit();
          }}
        >
          <label className="screen-reader" htmlFor={promptId}>
            描述你的编码任务
          </label>
          {completion.popup}
          <textarea
            {...completion.bindings}
            className="textarea"
            ref={input}
            id={promptId}
            maxLength={messageTextLimit}
            placeholder="Ask axiom…"
            data-tooltip={`${active ? "Enter 追加 Steering" : "Enter 发送"} · Shift+Enter 换行 · 双击 Esc 撤回排队内容`}
            lang="en"
            data-od-id="message-input"
            value={draft.text}
            onChange={(e) => {
              lastEscape.current = null;
              if (lengthError && error === lengthError) setError("");
              updateDraft(scope, { text: e.target.value });
            }}
            onBlur={() => { lastEscape.current = null; completion.bindings.onBlur(); }}
            onKeyDown={(e) => {
              if (completion.keyDown(e)) { lastEscape.current = null; return; }
              if (e.key === "Escape") {
                if (e.nativeEvent.isComposing || e.keyCode === 229 || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) {
                  lastEscape.current = null;
                  return;
                }
                e.preventDefault();
                e.stopPropagation();
                if (e.repeat || reading || busy) { lastEscape.current = null; return; }
                const now = performance.now();
                if (lastEscape.current !== null && now - lastEscape.current <= 500) {
                  lastEscape.current = null;
                  void recall();
                } else lastEscape.current = now;
                return;
              }
              lastEscape.current = null;
              if (
                e.key === "Enter" &&
                !e.shiftKey &&
                !e.nativeEvent.isComposing &&
                e.keyCode !== 229
              ) {
                e.preventDefault();
                if (!e.repeat && !reading && !imageUnsupported && hasContent)
                  void submit(active ? "append" : "prompt");
              }
            }}
          />
          <AttachmentInputOverlay input={input} draft={draft} />
          <div className="composer-tools">
            <div className="row">
              <AttachmentPicker scope={scope} nested={nested} input={input} onBusy={setReading} onError={setError} />
              <ModelPicker scope={scope} nested={nested} />
            </div>
            <div className="composer-actions">
            <button
              className={`btn btn-primary send${active ? " is-running" : ""}`}
              type="submit"
              aria-label={active ? "停止执行" : "发送消息"}
              data-tooltip={
                active
                  ? "停止此会话"
                  : selected
                    ? "发送消息"
                    : "请先选择可用模型"
              }
              disabled={
                busy ||
                !connected ||
                (!active &&
                  (!selected || reading || imageUnsupported || !!lengthError || !hasContent))
              }
            >
              {active ? (
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <rect x="6" y="6" width="12" height="12" rx="2" />
                </svg>
              ) : (
                <Icon name="arrow" />
              )}
            </button>
            </div>
          </div>
        </form>
        <Usage scope={scope} tools={tools} />
        <Connection active={active} extra={lengthError || error || (imageUnsupported ? "当前模型不支持图片，请选择支持图片的模型或移除图片。" : "")} />
      </div>
    </section>
  );
}
export function EmptyComposer({ onSelect, openWorkspace, picking = false, tools }: {
  tools?: UsageTools;
  picking?: boolean;
  onSelect?: (selection: Selection) => Promise<void>;
  openWorkspace: () => void;
}) {
  return (
    <section className="composer-area">
      <div className="container">
        <form className="composer" onSubmit={(e) => e.preventDefault()}>
          <textarea
            className="textarea"
            id="prompt"
            aria-label="描述你的编码任务"
            placeholder="Ask axiom…"
            lang="en"
            data-od-id="message-input"
            disabled
          />
          <div className="composer-tools">
            <div className="row">
              <FilePickerButton className="icon-btn" id="attach" label="添加附件" icon="plus" iconOnly disabled />
              {onSelect ? <ModelPicker onSelect={onSelect} /> : (
                <FilePickerButton className="btn btn-ghost" label="打开工作空间以选择模型" picking={picking} onClick={openWorkspace} />
              )}
            </div>
            <button
              className="btn btn-primary send"
              aria-label="发送消息"
              disabled
            >
              <Icon name="arrow" />
            </button>
          </div>
        </form>
        <Usage tools={tools} />
        <Connection />
      </div>
    </section>
  );
}
function Connection({ extra = "", active = false }: { extra?: string; active?: boolean }) {
  return (
    <div className="composer-foot">
      <span className="status" role="status">
        {extra}
      </span>
      <span>{active ? "Enter 追加 Steering" : "Enter 发送"} · Shift + Enter 换行 · 双击 Esc 撤回排队内容</span>
    </div>
  );
}
