import { useEffect, useState } from "react";
import { Icon } from "../Icon.js";
import { LocalPath } from "../LocalPath.js";
import { GitBranchBadge } from "./GitBranchBadge.js";
import { useConnection, useConnectionState, useScope } from "../transport.js";
import { openFileDialog } from "../OpenFileDialog.js";
import {
  scopeKey,
  type Scope,
  type Session,
  type Workspace,
} from "../../shared/protocol.js";
export async function pickWorkspaceFolder(signal: AbortSignal): Promise<string | null> {
  const items = await openFileDialog({ purpose: "workspace", kind: "folder", multiple: false }, signal);
  return items[0]?.path ?? null;
}

function ConnectionStatus() {
  const status = useConnection();
  const connected = useConnectionState().connected;
  // Browser users still receive accessible connection/diagnostic announcements.
  return <span className="connection-status screen-reader" data-connected={connected} role="status">{status}</span>;
}
function CopyTitle({ title }: { title: string }) {
  const [state, setState] = useState<"" | "copying" | "copied" | "failed">("");
  useEffect(() => {
    if (state !== "copied") return;
    const timer = setTimeout(() => setState(""), 1500);
    return () => clearTimeout(timer);
  }, [state]);
  const feedback = state === "copied" ? "已复制标题" : state === "failed" ? "复制失败，点击重试" : "";
  return <>
    <button type="button" className="icon-btn title-copy" aria-label="复制会话标题" data-tooltip={feedback || "复制会话标题"}
      disabled={state === "copying"} onClick={async () => {
        setState("copying");
        try { await navigator.clipboard.writeText(title); setState("copied"); }
        catch { setState("failed"); }
      }}><Icon name={state === "copied" ? "check" : "copy"} /></button>
    <span className="screen-reader" role="status">{feedback}</span>
  </>;
}

export function Title({
  workspace,
  scope,
  onError,
}: {
  workspace?: Workspace;
  scope: Scope | null;
  onError: (s: string) => void;
}) {
  const session = useScope<Session | null>(
    scope?.sessionId ? scopeKey(scope) : null,
    null,
  );
  const title = session?.title || "新对话";
  return (
    <div className="title-block">
      <div className="title-heading">
        <h1 id="chat-title">{title}</h1>
        <CopyTitle key={`${scope?.sessionId ?? ""}:${title}`} title={title} />
        <GitBranchBadge key={`${workspace?.id ?? ""}:${workspace?.path ?? ""}`} workspace={workspace} />
        <ConnectionStatus />
      </div>
      <div className="title-meta">
        <LocalPath textId="title-path" path={workspace?.path ?? ""} disabled={!workspace} onError={onError} copyLabel="复制工作空间路径" openLabel="打开系统文件管理器">
          {workspace?.path || "未关联文件夹"}
        </LocalPath>
      </div>
    </div>
  );
}
