import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useAnchoredPopup } from "../useAnchoredPopup.js";
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
  onDefaultSelect,
  onSelect,
  value,
  inheritLabel,
  disabled = false,
}: {
  value?: Selection | null;
  inheritLabel?: string;
  onDefaultSelect?: (selection: Selection | null) => Promise<void>;
  disabled?: boolean;
  onSelect?: (selection: Selection) => Promise<void>;
  scope?: Scope;
  nested?: boolean;
  childDefault?: boolean;
}) {
  const favorites = useScope("favorites", noFavorites);
  const favoriteKeys = useMemo(() => new Set(favorites.map((f) => JSON.stringify([f.provider, f.id]))), [favorites]);
  const favorite = (m: { provider: string; id: string }) => favoriteKeys.has(JSON.stringify([m.provider, m.id]));
  const config = useScope("configuration", emptyConfig),
    info = useScope(scope ? agentScope(scope) : null, emptyAgent),
    tasks = useScope(
      childDefault && scope ? tasksScope(scope) : null,
      emptyTasks,
    );
  const selection = value !== undefined ? value : childDefault ? tasks.defaultModel : info.selection;
  const [query, setQuery] = useState(""),
    [draft, setDraft] = useState<Selection | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const details = useRef<HTMLDetailsElement>(null);
  const [expanded, setExpanded] = useState(false);
  const floating = expanded && !details.current?.closest(".compression-settings,.memory-dialog");
  const { panel } = useAnchoredPopup(floating ? details.current : null, { maxWidth: 320, maxHeight: 440, fillMobile: true });
  useLayoutEffect(() => {
    if (floating && panel.current && !panel.current.matches(":popover-open")) panel.current.showPopover();
  }, [floating]);
  useEffect(() => {
    if (!floating) return;
    const outside = (event: PointerEvent) => { if (!details.current?.contains(event.target as Node)) close(false); };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [floating]);
  const effortId = useId();
  useEffect(() => {
    if (onDefaultSelect) setDraft(selection);
  }, [selection, onDefaultSelect]);
  const choose = async (next: Selection | null) => {
    setDraft(next);
    if (!onDefaultSelect) return;
    setBusy(true);
    setError("");
    try { await onDefaultSelect(next); }
    catch (e) { setDraft(selection); setError((e as Error).message); }
    finally { setBusy(false); }
  };
  const close = (restoreFocus = true) => {
    if (!details.current) return;
    if (panel.current?.matches(":popover-open")) panel.current.hidePopover();
    details.current.open = false;
    setExpanded(false);
    if (restoreFocus) details.current.querySelector("summary")?.focus();
  };
  const models = useMemo(() => expanded ? config.available
    .filter((m) =>
      `${m.provider} ${m.name} ${m.id}`
        .toLowerCase()
        .includes(query.trim().toLowerCase()),
    )
    .sort((a, b) => Number(favorite(b)) - Number(favorite(a))) : [], [expanded, config.available, query, favoriteKeys]);
  const chosen = config.available.find(
    (m) => m.provider === draft?.provider && m.id === draft.id,
  );
  return (
    <details
      ref={details}
      className="model-picker"
      id={nested || childDefault || onSelect ? undefined : "model-picker"}
      onToggle={(e) => {
        if (e.target !== e.currentTarget) return;
        setExpanded(e.currentTarget.open);
        if (e.currentTarget.open && disabled) {
          setExpanded(false);
          e.currentTarget.open = false;
          return;
        }
        if (e.currentTarget.open) {
          setDraft(selection);
          setQuery("");
          setError("");
        }
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape" && e.currentTarget.open) {
          // An IME candidate cancellation must not close this menu or an outer settings panel.
          if (e.nativeEvent.isComposing || e.keyCode === 229) { e.stopPropagation(); return; }
          e.preventDefault();
          e.stopPropagation();
          close();
        }
      }}
    >
      <summary
        aria-disabled={disabled || undefined}
        onClick={(e) => { if (disabled) e.preventDefault(); }}
        aria-label={
          childDefault ? "选择默认子模型" : "选择供应商、模型与思考等级"
        }
      >
        <span>
          {childDefault ? "默认子模型 · " : ""}
          {selection
            ? `${config.available.find((m) => m.provider === selection.provider && m.id === selection.id)?.name ?? selection.id} · ${selection.thinking}`
            : inheritLabel ?? (childDefault
              ? "继承主会话选择"
              : "未选择模型")}
        </span>
        <Icon name="chevron" />
      </summary>
      {expanded && <div ref={panel} className="model-popover" aria-label="模型选择" popover={floating ? "manual" : undefined} data-floating={floating || undefined}>
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
        <div className="model-list" aria-label="可用模型" aria-busy={busy}>
          {(childDefault || (inheritLabel && onDefaultSelect)) && (
            <button
              type="button"
              className="model-option"
              aria-pressed={!draft}
              disabled={busy || disabled}
              onClick={() => void choose(null)}
            >
              {inheritLabel ?? "继承创建时的主会话模型"}
            </button>
          )}
          {models.map((m) => (
              <div className="model-row" key={`${m.provider}/${m.id}`}>
                <button
                  type="button"
                  className="model-option"
                  disabled={busy || disabled}
                  data-tooltip={`${m.name}\n${m.provider} / ${m.id}`}
                  aria-pressed={
                    draft?.provider === m.provider && draft.id === m.id
                  }
                  onClick={() =>
                    void choose({
                      provider: m.provider,
                      id: m.id,
                      thinking: draft && m.levels.includes(draft.thinking)
                        ? draft.thinking
                        : m.levels[0],
                    })
                  }
                >
                  <span className="model-copy">
                    <span className="model-name">{m.name}</span>
                    <small className="model-provider-name">{m.provider}</small>
                  </span>
                  <Icon className="model-check" name="check" />
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
                  <Icon name="star" />
                </button>
              </div>
            ))}
          {!config.available.length && (
            <p className="model-empty" role="status">
              {config.error || "暂无可用模型，请先配置模型服务。"}
            </p>
          )}
          {!!config.available.length && !models.length && (
            <p className="model-empty" role="status">
              没有匹配的模型，试试其他名称或供应商。
            </p>
          )}
        </div>
        <fieldset className="model-reasoning" disabled={busy || disabled}>
          <legend>思考等级</legend>
          {chosen ? (
            <div className="model-levels">
              {chosen.levels.map((level) => (
                <label className="model-level" key={level}>
                  <input
                    type="radio"
                    name={effortId}
                    value={level}
                    checked={draft!.thinking === level}
                    onChange={() => void choose({ ...draft!, thinking: level })}
                  />
                  <span>{level === "off" ? "none" : level}</span>
                </label>
              ))}
            </div>
          ) : (
            <p>{!draft && inheritLabel ? inheritLabel : childDefault && !draft ? "随主会话模型继承" : "选择模型后设置"}</p>
          )}
        </fieldset>
        <div className="model-footer">
          <a className="model-manage" href="/model-config.html">模型服务</a>
          {onDefaultSelect ? <span role="status">{busy ? "保存中…" : "选择后自动保存"}</span> : <div className="model-actions">
            <button
              type="button"
              className="model-cancel"
              aria-label="取消模型设置"
              disabled={busy}
              onClick={() => close()}
            >
              取消
            </button>
            <button
              type="button"
              className="model-confirm"
              aria-label="确认模型设置"
              disabled={
                disabled || (!scope && !onSelect) ||
                (!(chosen && draft && chosen.levels.includes(draft.thinking)) && !(childDefault && !draft)) || busy
              }
              onClick={async () => {
                setBusy(true);
                setError("");
                try {
                  if (draft && onSelect) {
                    await onSelect(draft);
                  } else if (scope) {
                    await command(
                      childDefault ? "task.default-model" : "agent.model",
                      { selection: draft },
                      scope,
                    );
                  }
                  close();
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              {busy ? "保存中…" : "确认"}
            </button>
          </div>}
        </div>
        {running(info.run) && (
          <p className="meta">
            当前执行：{info.run!.selection.provider} / {info.run!.selection.id} · {info.run!.selection.thinking === "off" ? "none" : info.run!.selection.thinking}；模型和思考等级均在下次执行生效，本次追加消息仍沿用当前设置。
          </p>
        )}
        {error && <p className="execution-alert" role="alert">{error}</p>}
      </div>}
    </details>
  );
}
