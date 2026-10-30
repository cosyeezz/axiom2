import { useEffect, useRef, useState, type ReactNode } from "react";
import { isLocalPath, jsonLocalPaths } from "../shared/local-paths.js";
export { isLocalPath } from "../shared/local-paths.js";
import type { Scope } from "../shared/protocol.js";
import { Icon } from "./Icon.js";
import { command } from "./transport.js";
import "./styles/local-path.css";

export type PathTarget = { path: string; scope?: Scope; base?: "workspace" | "memory" };
export async function resolveLocalPath({ path, scope, base }: PathTarget): Promise<string> {
  return command<string>(base === "memory" ? "memory.resolve" : "paths.resolve", { path }, scope);
}
export async function revealLocalPath({ path, scope, base }: PathTarget): Promise<void> {
  await command("paths.reveal", { path: base === "memory" ? await resolveLocalPath({ path, scope, base }) : path }, scope);
}

type ActionsProps = PathTarget & {
  disabled?: boolean; onOpen?: () => Promise<unknown>; copyPath?: () => Promise<string>;
  onError?: (message: string) => void; copyLabel?: string; openLabel?: string; terminal?: boolean;
};
/** Shared actions stay siblings of links/buttons, so copying never activates a row. */
export function PathActions({ path, scope, base, disabled, onOpen, copyPath, onError, copyLabel = "复制路径", openLabel = "打开所在文件夹", terminal = false }: ActionsProps) {
  const [state, setState] = useState<"" | "copying" | "copied" | "copy-error" | "opening" | "terminal-opening">("");
  const [error, setError] = useState("");
  const alive = useRef(true), busy = useRef(false), generation = useRef(0);
  useEffect(() => { alive.current = true; return () => { alive.current = false; generation.current++; }; }, []);
  useEffect(() => { generation.current++; setState(""); setError(""); }, [path, base, scope?.workspaceId, scope?.sessionId]);
  useEffect(() => {
    if (state !== "copied") return;
    const timer = setTimeout(() => setState(""), 1500);
    return () => clearTimeout(timer);
  }, [state]);
  const act = async (kind: "copy" | "open" | "terminal") => {
    if (busy.current || disabled || !path) return;
    const current = generation.current;
    busy.current = true; setError(""); setState(kind === "copy" ? "copying" : kind === "terminal" ? "terminal-opening" : "opening");
    try {
      if (kind === "copy") {
        // Absolute paths can be copied even while the service is disconnected.
        const value = copyPath ? await copyPath() : /^(?:\/|[A-Za-z]:[\\/]|\\\\)/.test(path) ? path : await resolveLocalPath({ path, scope, base });
        await navigator.clipboard.writeText(value);
      } else if (kind === "terminal") {
        await command("paths.terminal", { path: base === "memory" ? await resolveLocalPath({ path, scope, base }) : path }, scope);
      } else await (onOpen ? onOpen() : revealLocalPath({ path, scope, base }));
      if (alive.current && generation.current === current) setState(kind === "copy" ? "copied" : "");
    } catch (cause) {
      const message = kind === "copy" ? "复制失败，点击重试" : (cause as Error).message || (kind === "terminal" ? "无法打开终端" : "无法打开所在文件夹");
      if (alive.current && generation.current === current) { setState(kind === "copy" ? "copy-error" : ""); setError(message); onError?.(message); }
    } finally { busy.current = false; }
  };
  const blocked = disabled || !path || state === "copying" || state === "opening" || state === "terminal-opening";
  const local = typeof location === "undefined" || ["127.0.0.1", "localhost", "[::1]"].includes(location.hostname);
  const openTooltip = local ? openLabel : `在电脑上${openLabel}`;
  return <span className="path-actions" onClick={event => event.stopPropagation()} onDoubleClick={event => event.stopPropagation()} onKeyDown={event => { if (event.key === "Enter" || event.key === " ") event.stopPropagation(); }}>
    <button type="button" className="icon-btn" disabled={blocked} aria-label={state === "copy-error" ? "复制失败，点击重试" : copyLabel} data-tooltip={`${state === "copied" ? "已复制路径" : state === "copy-error" ? error : copyLabel} · ${path}`} onClick={() => void act("copy")}><Icon name={state === "copied" ? "check" : "copy"} /></button>
    <button type="button" className="icon-btn" disabled={blocked} aria-busy={state === "opening"} aria-label={openLabel} data-tooltip={state === "opening" ? "正在打开…" : openTooltip} onClick={() => void act("open")}><Icon name="folder-open" /></button>
    {terminal && <button type="button" className="icon-btn" disabled={blocked} aria-busy={state === "terminal-opening"} aria-label="打开终端" data-tooltip={state === "terminal-opening" ? "正在打开终端…" : `${local ? "在当前路径打开终端" : "在电脑的当前路径打开终端"} · ${path}`} onClick={() => void act("terminal")}><Icon name="square-terminal" /></button>}
    <span className={error ? "local-path-error" : "screen-reader"} role={error ? "alert" : "status"}>{error || (state === "copied" ? "已复制路径" : "")}</span>
  </span>;
}

export function LocalPath({ children, className = "", textId, showActions = true, ...props }: ActionsProps & { children?: ReactNode; className?: string; textId?: string; showActions?: boolean }) {
  return <span className={`local-path ${className}`}>
    <span className="local-path-text" id={textId} data-tooltip={props.path}>{children ?? props.path}</span>
    {showActions && <PathActions {...props} />}
  </span>;
}
/** Resource sources may also be package names or URLs; only paths get filesystem actions. */
export function ResourceLocation({ value }: { value: string }) {
  return isLocalPath(value) ? <LocalPath path={value} /> : <code>{value}</code>;
}

export function JsonPaths({ text, scope }: { text: string; scope?: Scope }) {
  const paths = jsonLocalPaths(text);
  return paths.length ? <span className="json-local-paths">{paths.map(path => <LocalPath key={path} path={path} scope={scope} />)}</span> : null;
}

/** Resource notices use a label followed by one actual path, optionally a parenthetical note. */
export function PathNotice({ text }: { text: string }) {
  const match = text.match(/^(.*?[：:]\s*)((?:\/|[A-Za-z]:[\\/]|\\\\|~[\\/]).*?)(（[^]*）)?$/);
  return match ? <>{match[1]}<LocalPath path={match[2]} />{match[3]}</> : <>{text}</>;
}
