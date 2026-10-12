import { memo, useEffect, useRef, useState, type ReactNode } from "react";
import { marked, type Token } from "marked";
import { command, useScope } from "./transport.js";
import { Icon } from "./components.js";
import { updateDraft } from "./drafts.js";
import {
  agentScope,
  threadScope,
  messageScope,
  emptyAgent,
  emptyThread,
  running,
  runLabels,
  type ChatMessage,
  type Selection,
  type ThreadIndex,
} from "../shared/agent.js";
import type { Configuration, Scope } from "../shared/protocol.js";

// Render token AST as React nodes, never untrusted HTML. Raw HTML stays literal.
function tokens(items: Token[]): ReactNode {
  return items.map((t: any, i) => {
    const inner = () => (t.tokens ? tokens(t.tokens) : t.text);
    switch (t.type) {
      case "space":
        return null;
      case "heading": {
        const Tag = `h${Math.min(6, t.depth)}` as "h1";
        return <Tag key={i}>{inner()}</Tag>;
      }
      case "paragraph":
        return <p key={i}>{inner()}</p>;
      case "strong":
        return <strong key={i}>{inner()}</strong>;
      case "em":
        return <em key={i}>{inner()}</em>;
      case "del":
        return <del key={i}>{inner()}</del>;
      case "codespan":
        return <code key={i}>{t.text}</code>;
      case "code":
        return (
          <div className="code-card" key={i}>
            <div className="code-head">{t.lang || "代码"}</div>
            <pre>
              <code>{t.text}</code>
            </pre>
          </div>
        );
      case "blockquote":
        return <blockquote key={i}>{inner()}</blockquote>;
      case "list": {
        const Tag = t.ordered ? "ol" : "ul";
        return (
          <Tag key={i}>
            {t.items.map((item: any, n: number) => (
              <li key={n}>
                {item.task && (
                  <input
                    type="checkbox"
                    checked={item.checked}
                    readOnly
                    aria-label="任务状态"
                  />
                )}
                {tokens(item.tokens)}
              </li>
            ))}
          </Tag>
        );
      }
      case "link": {
        let safe = false;
        try {
          safe = ["http:", "https:", "mailto:"].includes(
            new URL(t.href, location.href).protocol,
          );
        } catch {}
        return safe ? (
          <a key={i} href={t.href} target="_blank" rel="noopener noreferrer">
            {inner()}
          </a>
        ) : (
          <span key={i}>{inner()}</span>
        );
      }
      case "image":
        return <span key={i}>[图片：{t.text}]</span>;
      case "br":
        return <br key={i} />;
      case "hr":
        return <hr key={i} />;
      case "table":
        return (
          <div className="table-scroll" key={i}>
            <table>
              <thead>
                <tr>
                  {t.header.map((cell: any, j: number) => (
                    <th key={j}>{tokens(cell.tokens)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {t.rows.map((row: any[], j: number) => (
                  <tr key={j}>
                    {row.map((cell: any, k: number) => (
                      <td key={k}>{tokens(cell.tokens)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      default:
        return <span key={i}>{t.tokens ? inner() : (t.text ?? t.raw)}</span>;
    }
  });
}
const Markdown = memo(({ text }: { text: string }) => (
  <>{tokens(marked.lexer(text))}</>
));
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
const Message = memo(function Message({
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
        <div
          className={`message-body markdown${m.role === "user" ? " user-text" : ""}`}
        >
          <Markdown text={m.text} />
        </div>
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
function Environment({ scope }: { scope: Scope }) {
  const info = useScope(agentScope(scope), emptyAgent),
    [error, setError] = useState("");
  return (
    <section className="session-init" aria-label="会话初始化信息">
      <details className="session-environment">
        <summary>
          <Icon name="chevron" />
          <span>会话环境</span>
          <small>
            主会话 · {info.run ? runLabels[info.run.status] : "尚未运行"}
          </small>
        </summary>
        <header className="session-init-head">
          <span>会话初始化</span>
          <span>
            {info.run
              ? `${info.run.selection.provider} / ${info.run.selection.id}`
              : "首次发送时加载 pi"}
          </span>
        </header>
        <div className="session-init-body">
          <p>
            {info.environment
              ? `工作目录：${info.environment.cwd}`
              : "尚未加载模型、系统提示词与工具；请先选择可用模型。"}
          </p>
          {info.environment && (
            <>
              <p>工具：{info.environment.tools.join("、") || "无"}</p>
              <p>
                技能：{info.environment.skills.join("、") || "无"} ·
                已加载扩展：{info.environment.extensions}
              </p>
              {info.environment.warnings.map((w, i) => (
                <p key={i}>{w}</p>
              ))}
            </>
          )}
          <button
            className="btn"
            disabled={running(info.run)}
            onClick={async () => {
              if (
                !confirm(
                  "授权加载此项目的 pi 设置、技能、扩展与依赖？项目扩展可以执行任意代码。仅应信任你审查过的项目。",
                )
              )
                return;
              try {
                await command(
                  "agent.trust",
                  { trusted: true, confirmed: true },
                  scope,
                );
                setError("已授权，下次执行按 pi 规则加载。");
              } catch (e) {
                setError((e as Error).message);
              }
            }}
          >
            授权项目资源
          </button>
          <p role="status">{error}</p>
        </div>
      </details>
    </section>
  );
}
function RunState({ scope }: { scope: Scope }) {
  const info = useScope(agentScope(scope), emptyAgent),
    [error, setError] = useState("");
  if (!info.run) return null;
  return (
    <div className={running(info.run) ? "run-state" : "meta"} role="status">
      {running(info.run) && <span className="run-spinner" />}
      <span>
        {info.phase && running(info.run)
          ? info.phase
          : runLabels[info.run.status]}
        {info.run.error && ` · ${info.run.error}`}
      </span>
      {!running(info.run) && info.run.cleanup === "unconfirmed" && (
        <button
          className="btn"
          onClick={async () => {
            if (
              !confirm(
                "我已检查并终止上次执行可能残留的命令和进程。确认后才允许继续；这不会回滚文件。",
              )
            )
              return;
            try {
              await command(
                "agent.confirm-cleanup",
                { confirmed: true, runId: info.run!.id },
                scope,
              );
            } catch (e) {
              setError((e as Error).message);
            }
          }}
        >
          确认已清理
        </button>
      )}
      {error}
    </div>
  );
}
export const AgentThread = memo(function AgentThread({
  scope,
}: {
  scope: Scope | null;
}) {
  const index = useScope(
      scope?.sessionId ? threadScope(scope) : null,
      emptyThread,
    ),
    [page, setPage] = useState<ThreadIndex | null>(null),
    [error, setError] = useState("");
  const scroller = useRef<HTMLElement>(null),
    content = useRef<HTMLDivElement>(null),
    bottom = useRef(true);
  useEffect(() => {
    const observer = new ResizeObserver(() => {
      if (bottom.current && !getSelection()?.toString())
        scroller.current?.scrollTo({ top: scroller.current.scrollHeight });
    });
    if (content.current) observer.observe(content.current);
    return () => observer.disconnect();
  }, []);
  const shown = page ?? index;
  return (
    <section
      ref={scroller}
      className="thread"
      id="thread"
      aria-label="消息记录"
      onScroll={(e) => {
        const n = e.currentTarget;
        bottom.current = n.scrollHeight - n.scrollTop - n.clientHeight < 60;
      }}
    >
      <div ref={content} className="container thread-content">
        <div id="messages">
          {scope?.sessionId && <Environment scope={scope} />}
          {(shown.error || error) && (
            <p className="execution-alert">{shown.error || error}</p>
          )}
          {shown.before && (
            <button
              className="btn"
              onClick={async () => {
                try {
                  bottom.current = false;
                  setPage(
                    await command<ThreadIndex>(
                      "thread.history",
                      { before: shown.before },
                      scope!,
                    ),
                  );
                  scroller.current?.scrollTo({ top: 0 });
                } catch (e) {
                  setError((e as Error).message);
                }
              }}
            >
              更早的消息
            </button>
          )}
          {page && (
            <button
              className="btn"
              onClick={() => {
                bottom.current = true;
                setPage(null);
              }}
            >
              回到最新消息
            </button>
          )}
          {scope?.sessionId &&
            shown.ids.map((id) => <Message key={id} scope={scope} id={id} />)}
          {!index.ids.length && !index.error && (
            <div className="empty-state">
              <h2>从一个想法，一行代码开始。</h2>
              <p>描述目标、粘贴代码，或附上需要检查的文件。支持 Markdown。</p>
              <div className="quick-prompts">
                {[
                  ["审查代码", "帮我分析这段代码的潜在问题："],
                  ["规划功能", "请帮我规划以下功能的实现步骤："],
                  ["排查错误", "请解释以下错误，并给出排查建议："],
                ].map(([label, text]) => (
                  <button
                    className="btn"
                    key={label}
                    disabled={!scope?.sessionId}
                    onClick={() => {
                      updateDraft(scope!, { text });
                      document.getElementById("prompt")?.focus();
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          )}
          {scope?.sessionId && <RunState scope={scope} />}
        </div>
      </div>
    </section>
  );
});
const emptyConfig: Configuration = {
  revision: "",
  providerCount: 0,
  modelCount: 0,
  available: [],
  dataRoot: "",
};
export function ModelPicker({ scope }: { scope?: Scope }) {
  const config = useScope("configuration", emptyConfig),
    info = useScope(scope ? agentScope(scope) : null, emptyAgent);
  const [query, setQuery] = useState(""),
    [draft, setDraft] = useState<Selection | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const details = useRef<HTMLDetailsElement>(null);
  const chosen = config.available.find(
    (m) => m.provider === draft?.provider && m.id === draft.id,
  );
  return (
    <details
      ref={details}
      className="model-picker"
      id="model-picker"
      onToggle={(e) => {
        if (e.currentTarget.open) {
          setDraft(info.selection);
          setError("");
        }
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.currentTarget.open = false;
          e.currentTarget.querySelector("summary")?.focus();
        }
      }}
    >
      <summary aria-label="选择供应商、模型与思考等级">
        <span>
          {info.selection
            ? `${config.available.find((m) => m.provider === info.selection!.provider && m.id === info.selection!.id)?.name ?? info.selection.id} · ${info.selection.thinking}`
            : "未选择模型"}
        </span>
        <Icon name="chevron" />
      </summary>
      <div className="model-popover" aria-label="模型选择">
        <label className="model-search">
          <Icon name="search" />
          <input
            type="search"
            placeholder="搜索模型或供应商…"
            aria-label="搜索模型或供应商"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <div className="model-list">
          {config.available
            .filter((m) =>
              `${m.provider} ${m.name} ${m.id}`
                .toLowerCase()
                .includes(query.trim().toLowerCase()),
            )
            .map((m) => (
              <div className="model-row" key={`${m.provider}/${m.id}`}>
                <button
                  type="button"
                  className="model-option"
                  aria-pressed={
                    draft?.provider === m.provider && draft.id === m.id
                  }
                  onClick={() =>
                    setDraft({
                      provider: m.provider,
                      id: m.id,
                      thinking: m.levels.includes(draft?.thinking!)
                        ? draft!.thinking
                        : m.levels[0],
                    })
                  }
                >
                  <span>
                    {m.name} <small>[{m.provider}]</small>
                  </span>
                  <svg
                    className="model-check"
                    viewBox="0 0 24 24"
                    aria-hidden="true"
                  >
                    <path d="m5 12 4 4L19 6" />
                  </svg>
                </button>
              </div>
            ))}
          {!config.available.length && (
            <p className="model-empty" role="status">
              {config.error || "暂无可用模型，请先配置模型服务。"}
            </p>
          )}
          <a className="model-option" href="/model-config.html">
            前往模型服务
          </a>
        </div>
        <div className="model-footer">
          <span className="effort-heading">思考</span>
          <div className="effort-options">
            {chosen ? (
              <select
                aria-label="思考等级"
                value={draft!.thinking}
                onChange={(e) =>
                  setDraft({
                    ...draft!,
                    thinking: e.target.value as Selection["thinking"],
                  })
                }
              >
                {chosen.levels.map((l) => (
                  <option key={l} value={l}>
                    {l === "off" ? "none" : l}
                  </option>
                ))}
              </select>
            ) : (
              "—"
            )}
          </div>
          <div className="model-actions">
            <button
              type="button"
              className="icon-btn"
              aria-label="取消模型设置"
              onClick={() => {
                details.current!.open = false;
              }}
            >
              <Icon name="close" />
            </button>
            <button
              type="button"
              className="icon-btn"
              aria-label="确认模型设置"
              disabled={!scope || !chosen || busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await command("agent.model", { selection: draft }, scope);
                  details.current!.open = false;
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="m5 12 4 4L19 6" />
              </svg>
            </button>
          </div>
        </div>
        {running(info.run) && (
          <p className="meta">
            当前执行：{info.run!.selection.id}；确认的选择用于下次执行。
          </p>
        )}
        {error && <p className="execution-alert">{error}</p>}
      </div>
    </details>
  );
}
