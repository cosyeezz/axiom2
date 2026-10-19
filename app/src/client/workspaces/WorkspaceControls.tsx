import { useState } from "react";
import { useConnection, useConnectionState, useScope } from "../transport.js";
import { Icon } from "../components.js";
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
export function Title({
  workspace,
  scope,
  onError,
}: {
  workspace?: Workspace;
  scope: Scope | null;
  onError: (s: string) => void;
}) {
  const [revealing, setRevealing] = useState(false);
  const session = useScope<Session | null>(
    scope?.sessionId ? scopeKey(scope) : null,
    null,
  );
  return (
    <div className="title-block">
      <div className="title-heading">
        <h1 id="chat-title">{session?.title || "新对话"}</h1>
        <ConnectionStatus />
      </div>
      <div className="title-meta">
        <span id="title-path" data-tooltip={workspace?.path}>
          {workspace?.path || "未关联文件夹"}
        </span>
        <span className="path-actions">
          <button
            className="icon-btn"
            disabled={!workspace}
            aria-label="复制工作空间路径"
            data-tooltip={workspace ? `复制路径 · ${workspace.path}` : undefined}
            onClick={() =>
              navigator.clipboard
                .writeText(workspace!.path)
                .catch(() => onError("无法访问剪贴板，请手动复制路径"))
            }
          >
            <Icon name="copy" />
          </button>
          <button
            className="icon-btn"
            disabled={!workspace || revealing}
            aria-label="打开系统文件管理器"
            aria-busy={revealing}
            onClick={async () => {
              setRevealing(true);
              try {
                const response = await fetch(
                  `/api/workspace/reveal?id=${workspace!.id}`,
                  { method: "POST" },
                );
                if (!response.ok) onError(await response.text() || "无法打开系统文件管理器");
              } catch { onError("无法打开系统文件管理器"); }
              finally { setRevealing(false); }
            }}
          >
            <Icon name="folder-open" />
          </button>
        </span>
      </div>
    </div>
  );
}
