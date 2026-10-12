import { useRef, useState } from "react";
import { command, useScope } from "../transport.js";
import { Icon } from "../components.js";
import {
  agentScope,
  emptyAgent,
  running,
  type Selection,
} from "../../shared/agent.js";
import { tasksScope, emptyTasks } from "../../shared/tasks.js";
import type { Configuration, Scope } from "../../shared/protocol.js";
const emptyConfig: Configuration = {
  revision: "",
  providerCount: 0,
  modelCount: 0,
  available: [],
  dataRoot: "",
};
const noFavorites: { provider: string; id: string }[] = [];
export function ModelPicker({
  scope,
  nested = false,
  childDefault = false,
}: {
  scope?: Scope;
  nested?: boolean;
  childDefault?: boolean;
}) {
  const favorites = useScope("favorites", noFavorites);
  const favorite = (m: { provider: string; id: string }) =>
    favorites.some((f) => f.provider === m.provider && f.id === m.id);
  const config = useScope("configuration", emptyConfig),
    info = useScope(scope ? agentScope(scope) : null, emptyAgent),
    tasks = useScope(
      childDefault && scope ? tasksScope(scope) : null,
      emptyTasks,
    );
  const selection = childDefault ? tasks.defaultModel : info.selection;
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
      id={nested || childDefault ? undefined : "model-picker"}
      onToggle={(e) => {
        if (e.currentTarget.open) {
          setDraft(selection);
          setError("");
        }
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          e.currentTarget.open = false;
          e.currentTarget.querySelector("summary")?.focus();
        }
      }}
    >
      <summary
        aria-label={
          childDefault ? "选择默认子模型" : "选择供应商、模型与思考等级"
        }
      >
        <span>
          {childDefault ? "默认子模型 · " : ""}
          {selection
            ? `${config.available.find((m) => m.provider === selection.provider && m.id === selection.id)?.name ?? selection.id} · ${selection.thinking}`
            : childDefault
              ? "继承主会话选择"
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
          {childDefault && (
            <button
              type="button"
              className="model-option"
              aria-pressed={!draft}
              onClick={() => setDraft(null)}
            >
              继承创建时的主会话模型
            </button>
          )}
          {config.available
            .filter((m) =>
              `${m.provider} ${m.name} ${m.id}`
                .toLowerCase()
                .includes(query.trim().toLowerCase()),
            )
            .sort((a, b) => Number(favorite(b)) - Number(favorite(a)))
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
                <button
                  type="button"
                  className="icon-btn model-favorite"
                  aria-label={`${favorite(m) ? "取消收藏" : "收藏模型"}：${m.name}`}
                  aria-pressed={favorite(m)}
                  onClick={async () => {
                    try {
                      await command("favorites.set", {
                        provider: m.provider,
                        id: m.id,
                        favorite: !favorite(m),
                      });
                    } catch (e) {
                      setError((e as Error).message);
                    }
                  }}
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="m12 3 2.8 5.7 6.3.9-4.6 4.4 1.1 6.3-5.6-3-5.6 3 1.1-6.3L2.9 9.6l6.3-.9Z" />
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
              disabled={
                !scope || (!chosen && !(childDefault && !draft)) || busy
              }
              onClick={async () => {
                setBusy(true);
                try {
                  await command(
                    childDefault ? "task.default-model" : "agent.model",
                    { selection: draft },
                    scope,
                  );
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
