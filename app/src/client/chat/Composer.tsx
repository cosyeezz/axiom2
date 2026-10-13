import { useEffect, useRef } from "react";
import { useConnection, useScope } from "../transport.js";
import { useDraft, updateDraft } from "../drafts.js";
import { Icon } from "../components.js";
import { type Configuration, type Scope } from "../../shared/protocol.js";
import { agentScope, emptyAgent, running } from "../../shared/agent.js";
import { tasksScope, emptyTasks, taskActive } from "../../shared/tasks.js";
import { ModelPicker } from "./ModelPicker.js";
import { Usage } from "./Usage.js";
import { useSubmission } from "./useSubmission.js";
import { DraftRecovery } from "./DraftRecovery.js";
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
}: {
  scope: Scope;
  nested?: boolean;
}) {
  const info = useScope(agentScope(scope), emptyAgent),
    tasks = useScope(!nested ? tasksScope(scope) : null, emptyTasks),
    config = useScope("configuration", noConfig),
    connection = useConnection();
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
  const draft = useDraft(scope),
    input = useRef<HTMLTextAreaElement>(null),
    file = useRef<HTMLInputElement>(null);
  const { busy, error, setError, uncertain, submit, reconcile } = useSubmission(
    scope,
    draft,
    {
      active,
      nested,
      selected,
      connected: connection === "已连接本地服务",
      runId: info.run?.id,
    },
  );
  useEffect(() => {
    const node = input.current!;
    node.style.height = "44px";
    node.style.height = `${Math.min(180, Math.max(44, node.scrollHeight))}px`;
  }, [draft.text]);
  return (
    <section className="composer-area">
      <div className="container">
        <form
          className="composer"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <label className="screen-reader" htmlFor={promptId}>
            描述你的编码任务
          </label>
          <textarea
            className="textarea"
            ref={input}
            id={promptId}
            maxLength={12000}
            placeholder="Ask axiom…"
            lang="en"
            data-od-id="message-input"
            value={draft.text}
            onChange={(e) => updateDraft(scope, { text: e.target.value })}
            onKeyDown={(e) => {
              if (
                e.key === "Enter" &&
                !e.shiftKey &&
                !e.nativeEvent.isComposing &&
                e.keyCode !== 229
              ) {
                e.preventDefault();
                if (!active || nested)
                  void submit(nested && active ? "append" : "prompt");
              }
            }}
          />
          <div className="attachment">
            {draft.attachment && (
              <>
                {draft.attachment.name}
                <button
                  type="button"
                  className="icon-btn"
                  aria-label="移除附件"
                  onClick={() => updateDraft(scope, { attachment: null })}
                >
                  <Icon name="close" />
                </button>
              </>
            )}
          </div>
          <div className="composer-tools">
            <div className="row">
              <button
                type="button"
                className="icon-btn attach-button"
                id={nested ? undefined : "attach"}
                aria-label="附加文本或代码文件"
                onClick={() => file.current?.click()}
              >
                <Icon name="plus" />
              </button>
              <input
                ref={file}
                type="file"
                hidden
                accept=".txt,.md,.js,.jsx,.ts,.tsx,.json,.py,.css,.html"
                onChange={async (e) => {
                  const f = e.target.files?.[0];
                  e.target.value = "";
                  if (!f) return;
                  const owner = { ...scope };
                  try {
                    if (
                      f.size > 100000 ||
                      !/\.(txt|md|js|jsx|ts|tsx|json|py|css|html)$/i.test(
                        f.name,
                      )
                    )
                      throw Error("请使用小于 100 KB 的文本或代码文件");
                    const text = await f.text();
                    if (text.includes("\0")) throw Error("附件不是文本文件");
                    updateDraft(owner, { attachment: { name: f.name, text } });
                  } catch (e) {
                    setError((e as Error).message);
                  }
                }}
              />
              <ModelPicker scope={scope} nested={nested} />
              {nested && active && (
                <button
                  type="button"
                  className="btn append-button"
                  disabled={
                    busy ||
                    connection !== "已连接本地服务" ||
                    !!uncertain ||
                    (!draft.text.trim() && !draft.attachment)
                  }
                  onClick={() => void submit("append")}
                >
                  发送追问
                </button>
              )}
            </div>
            <button
              className={`btn btn-primary send${active ? " is-running" : ""}`}
              type="submit"
              aria-label={active ? "停止执行" : "发送消息"}
              title={
                active
                  ? "停止此会话"
                  : selected
                    ? "发送消息"
                    : "请先选择可用模型"
              }
              disabled={
                busy ||
                (!active && !!uncertain) ||
                connection !== "已连接本地服务" ||
                (!active &&
                  (!selected ||
                    (!draft.text.trim() && !draft.attachment) ||
                    info.run?.cleanup === "unconfirmed"))
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
        {!nested && <ModelPicker scope={scope} childDefault />}
        {!active &&
          info.run &&
          ["cancelled", "interrupted", "failed"].includes(info.run.status) && (
            <button
              className="btn"
              disabled={
                busy ||
                !!uncertain ||
                !selected ||
                info.run.cleanup !== "confirmed"
              }
              onClick={() => void submit("agent.continue")}
            >
              显式继续
            </button>
          )}
        {uncertain && (
          <button
            className="btn"
            disabled={busy}
            onClick={() => void reconcile()}
          >
            核实发送状态（不重发）
          </button>
        )}
        <Usage scope={scope} />
        <Connection extra={error || draft.error} />
        <DraftRecovery scope={scope} />
      </div>
    </section>
  );
}
export function EmptyComposer() {
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
              <button
                className="icon-btn"
                id="attach"
                aria-label="附加文本或代码文件"
                disabled
              >
                <Icon name="plus" />
              </button>
              <ModelPicker />
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
        <Usage />
        <Connection />
      </div>
    </section>
  );
}
function Connection({ extra = "" }: { extra?: string }) {
  const status = useConnection();
  return (
    <div className="composer-foot">
      <span className="status" role="status">
        {extra || status}
      </span>
      <span>Enter 发送 · Shift + Enter 换行</span>
    </div>
  );
}
