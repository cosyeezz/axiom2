import { memo, useState } from "react";
import { command, useScope } from "../transport.js";
import { Icon } from "../components.js";
import { messageScope, type ChatMessage } from "../../shared/agent.js";
import type { Scope } from "../../shared/protocol.js";
import { TaskCards } from "../tasks/TaskCards.js";
import { Markdown } from "./Markdown.js";
const Tool = memo(function Tool({
  scope,
  call,
}: {
  scope: Scope;
  call: NonNullable<ChatMessage["calls"]>[number];
}) {
  const result = useScope<ChatMessage | null>(
    messageScope(scope, `tool-${call.id}`),
    null,
  );
  return (
    <details className="tool-call" data-status={result?.status || "record"}>
      <summary>
        <span>{call.name}</span>
        <small>
          {result?.status === "running"
            ? "执行中"
            : result?.status === "failed"
              ? "失败"
              : result?.status === "completed"
                ? "已完成"
                : "未确认完成"}
          {result?.durationMs != null
            ? ` · ${(result.durationMs / 1000).toFixed(1)}s`
            : ""}
        </small>
      </summary>
      <h4>输入参数</h4>
      <pre>{call.input}</pre>
      <h4>执行输出</h4>
      <pre>{result?.text || "尚未记录输出"}</pre>
      {result?.truncated && <FullMessage scope={scope} id={result.id} />}
    </details>
  );
});
function FullMessage({ scope, id }: { scope: Scope; id: string }) {
  const [text, setText] = useState("");
  return (
    <>
      <button
        type="button"
        className="btn"
        onClick={async () => {
          try {
            const m = await command<ChatMessage>("message.get", { id }, scope);
            setText(m.text);
          } catch (e) {
            setText((e as Error).message);
          }
        }}
      >
        展开完整文本
      </button>
      {text && <pre>{text}</pre>}
    </>
  );
}
export const Message = memo(function Message({
  scope,
  id,
}: {
  scope: Scope;
  id: string;
}) {
  const m = useScope<ChatMessage | null>(messageScope(scope, id), null),
    [feedback, setFeedback] = useState("");
  if (!m || m.role === "toolResult") return null;
  return (
    <article
      className={`log-row${m.streaming ? " message-progress" : " message-result"}${m.status === "cancelled" ? " message-stopped" : ""}`}
      aria-label={m.role === "user" ? "用户消息" : "助手回复"}
    >
      <div>
        {m.status === "cancelled" && (
          <p className="message-state">回复已停止</p>
        )}
        {m.thinking && (
          <details className="activity">
            <summary>思考内容</summary>
            <div className="activity-content">
              <Markdown text={m.thinking} />
            </div>
          </details>
        )}
        {m.role === "user" && m.text.startsWith("页面元素评论：") ? (
          <section className="annotation-card" aria-label="元素评论附件">
            <strong>元素评论</strong>
            <p>{m.text.split("\n")[0].slice("页面元素评论：".length)}</p>
            <details>
              <summary>页面定位资料（引用数据）</summary>
              <pre>{m.text.slice(m.text.indexOf("\n") + 1)}</pre>
            </details>
          </section>
        ) : (
          <div
            className={`message-body markdown${m.role === "user" ? " user-text" : ""}`}
          >
            <Markdown text={m.text} />
          </div>
        )}
        {m.calls?.some((c) => c.name === "delegate") && (
          <TaskCards
            scope={scope}
            anchors={m.calls
              .filter((c) => c.name === "delegate")
              .map((c) => c.id)}
          />
        )}
        {m.calls?.length ? (
          <details className="activity">
            <summary>
              <Icon name="chevron" />
              <span>工具调用 · {m.calls.length} 项</span>
              <span className="activity-hint">展开记录</span>
            </summary>
            <div className="activity-content">
              {m.calls.map((call) => (
                <Tool key={call.id} scope={scope} call={call} />
              ))}
            </div>
          </details>
        ) : null}
        {m.error && (
          <p className="execution-alert" role="alert">
            {m.error}
          </p>
        )}
        {m.truncated && <FullMessage scope={scope} id={id} />}
        {m.role === "assistant" && !m.streaming && (
          <footer className="message-actions">
            <button
              type="button"
              aria-label="复制回复的 Markdown 原文"
              onClick={async () => {
                try {
                  const full = m.truncated
                    ? await command<ChatMessage>("message.get", { id }, scope)
                    : m;
                  await navigator.clipboard.writeText(full.text);
                  setFeedback("已复制");
                } catch {
                  setFeedback("复制失败");
                }
              }}
            >
              <Icon name="copy" />
              {feedback || "复制回复"}
            </button>
          </footer>
        )}
      </div>
    </article>
  );
});
