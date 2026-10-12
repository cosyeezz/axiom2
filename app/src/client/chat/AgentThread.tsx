import { memo, useEffect, useRef, useState } from "react";
import { command, useScope } from "../transport.js";
import { updateDraft } from "../drafts.js";
import {
  threadScope,
  emptyThread,
  type ThreadIndex,
} from "../../shared/agent.js";
import type { Scope } from "../../shared/protocol.js";
import { Message } from "./Message.js";
import { Environment, RunState } from "./SessionState.js";
export const AgentThread = memo(function AgentThread({
  scope,
  nested = false,
}: {
  scope: Scope | null;
  nested?: boolean;
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
      id={nested ? undefined : "thread"}
      aria-label="消息记录"
      onScroll={(e) => {
        const n = e.currentTarget;
        bottom.current = n.scrollHeight - n.scrollTop - n.clientHeight < 60;
      }}
    >
      <div ref={content} className="container thread-content">
        <div id={nested ? undefined : "messages"}>
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
                      document
                        .getElementById(
                          nested ? `prompt-${scope!.sessionId}` : "prompt",
                        )
                        ?.focus();
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
