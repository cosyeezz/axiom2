import { useEffect, useRef, useState } from "react";
import { useComposerHeight } from "./useComposerHeight.js";
import { FilePickerButton } from "../FilePicker.js";
import { useConnection, useConnectionState, useScope } from "../transport.js";
import { SkillCards } from "./SkillCards.js";
import { getComposerDraft as getDraft, useComposerDraft as useDraft, updateComposerDraft as updateDraft, useComposerEdit, cancelComposerEdit } from "./composer-edit.js";
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
import { SubmissionFeedback } from "./SubmissionFeedback.js";
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
    selected = !!info.selection;
  usePersistentDraft(scope);
  const editing = useComposerEdit(scope);
  const draft = useDraft(scope),
    input = useRef<HTMLTextAreaElement>(null);
  const [reading, setReading] = useState(false);
  const lastEscape = useRef<number | null>(null);
  useEffect(() => { lastEscape.current = null; }, [scope.workspaceId, scope.sessionId]);
  const completion = useFileCompletion(scope, draft.text, input);
  const hasContent = !!(draft.text.trim() || draft.attachment || draft.attachments?.length || draft.images?.length || draft.skills?.length);
  const canClear = !!draft.text.length || hasContent;
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
  const send = () => {
    if (editing) void submit("prompt", { draft: editing.draft, rewrite: editing.target, onStart: () => cancelComposerEdit(scope) });
    else void submit(active ? "append" : "prompt");
  };
  useEffect(() => {
    if (!editing) return;
    input.current?.focus({ preventScroll: true });
    input.current?.setSelectionRange(editing.draft.text.length, editing.draft.text.length);
  }, [editing?.revision]);
  useComposerHeight(input, editing ? editing.draft.text : draft.text);
  return (
    <section className="composer-area">
      <div className="container">
        <SteeringQueue scope={scope} nested={nested} />
        <SubmissionFeedback scope={scope} nested={nested} />
        <AnnotationTray scope={scope} disabled={busy || !connected || (!active && !selected)}
          send={(items, text, supplement) => void submit(active ? "append" : "prompt", {
            draft: { text, attachment: null }, onStart: () => clearSentAnnotations(scope, items, supplement),
          })} />

        {editing && <div className="composer-edit-status" role="status">
          <span>正在修改所选消息 · 重新发送后将从这里继续对话</span>
          <button type="button" className="btn" disabled={busy || reading} onClick={() => cancelComposerEdit(scope)}>取消修改</button>
        </div>}
        <div className="composer-resources" aria-label="技能与待发送附件">
          <SkillCards skills={draft.skills} scope={scope} onRemove={id => updateDraft(scope, { skills: getDraft(scope).skills?.filter(skill => skill.id !== id) })} />
          <AttachmentList scope={scope} draft={draft} reading={reading} />
        </div>
        <form
          className="composer"
          onSubmit={(e) => {
            e.preventDefault();
            if (active) void submit("stop");
            else if (!reading && !imageUnsupported && hasContent) send();
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
                if (editing) { cancelComposerEdit(scope); lastEscape.current = null; return; }
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
                  send();
              }
            }}
          />
          <AttachmentInputOverlay input={input} draft={draft} />
          <div className="composer-tools">
            <div className="row">
              <AttachmentPicker scope={scope} nested={nested} input={input} onBusy={setReading} onError={setError} />
              <div className="composer-model-controls">
                {canClear && <button type="button" className="icon-btn composer-clear" aria-label="清空输入"
                  data-tooltip="清空输入（文字、附件、图片和技能引用）" disabled={busy || reading}
                  onClick={() => {
                    updateDraft(scope, { text: "", attachment: null, attachments: [], images: [], skills: [] });
                    setError("");
                    lastEscape.current = null;
                    input.current?.focus({ preventScroll: true });
                  }}><Icon name="eraser" /></button>}
                <ModelPicker scope={scope} nested={nested} />
              </div>
            </div>
            <button
              className={`btn btn-primary send${active ? " is-running" : ""}`}
              type="submit"
              aria-label={active ? "停止执行" : editing ? "重新发送" : "发送消息"}
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
        </form>
        <Usage scope={scope} tools={tools} />
        <Connection active={active} extra={lengthError || error || (imageUnsupported ? "当前模型不支持图片，请选择支持图片的模型或移除图片。" : "")} />
      </div>
    </section>
  );
}
export function EmptyComposer({ onSelect, openWorkspace, picking = false, tools, preparing }: {
  preparing?: { text: string; onChange: (text: string) => void; uncertain: boolean; verify: () => void };
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
            disabled={!preparing}
            autoFocus={!!preparing}
            maxLength={messageTextLimit}
            value={preparing?.text ?? ""}
            onChange={event => preparing?.onChange(event.target.value)}
          />
          <div className="composer-tools">
            <div className="row">
              <FilePickerButton className="icon-btn" id="attach" label="添加附件" icon="plus" iconOnly disabled />
              {preparing ? <span className="meta" role="status">{preparing.uncertain ? "新建结果待确认，输入已保留" : "新对话已打开，可以先输入…"}</span> : onSelect ? <ModelPicker onSelect={onSelect} /> : (
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
        {preparing?.uncertain && <button type="button" className="btn" onClick={preparing.verify}>核实新建结果</button>}
        <Connection extra={preparing && !preparing.uncertain ? "后台正在准备会话，准备完成后即可发送。" : ""} />
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
