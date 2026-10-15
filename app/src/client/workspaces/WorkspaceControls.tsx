import { useState } from "react";
import { useConnection, useScope } from "../transport.js";
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
  const connected = status === "已连接本地服务";
  return (
    <span className="connection-status" data-connected={connected} role="status" aria-label={status} data-tooltip={status}>
      <span className="screen-reader">{status}</span>
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M0 0h24v24H0z" fill="none" />
        {connected ? (
          <>
            <path fill="currentColor" d="m12.922 16.587l-3.671 3.671a3.896 3.896 0 0 1-5.504-5.509l-.002.002l3.671-3.671a1.3 1.3 0 0 0-1.837-1.835l.001-.001l-3.671 3.671a6.494 6.494 0 0 0 9.187 9.175l-.003.002l3.671-3.671a1.3 1.3 0 0 0-1.837-1.835l.001-.001zM24.007 6.489A6.494 6.494 0 0 0 12.921 1.9L9.25 5.571a1.3 1.3 0 1 0 1.835 1.837l.001-.001l3.671-3.671a3.896 3.896 0 0 1 5.504 5.509l.002-.002l-3.671 3.671a1.3 1.3 0 1 0 1.835 1.837l.001-.001l3.671-3.671a6.43 6.43 0 0 0 1.908-4.58V6.49z" />
            <path fill="currentColor" d="M7.412 16.592c.235.235.559.38.918.38s.683-.145.918-.38L16.59 9.25a1.3 1.3 0 0 0-1.837-1.835l.001-.001l-7.342 7.342c-.235.235-.38.559-.38.918s.145.683.38.918" />
          </>
        ) : (
          <path fill="currentColor" d="M15.184 20.239c-.61 0-1.104.494-1.104 1.104v1.586a1.104 1.104 0 1 0 2.208 0v-.033v.002v-1.555c0-.609-.494-1.104-1.103-1.104zm7.714-6.159h-1.555a1.105 1.105 0 0 0-.001 2.208h1.557a1.105 1.105 0 0 0 .001-2.208zm-2.579 4.678a1.104 1.104 0 0 0-1.559 1.561l-.001-.001l1.099 1.099a1.104 1.104 0 1 0 1.561-1.559l-.001-.001zM8.817 3.762c.61 0 1.104-.494 1.104-1.104V1.104a1.105 1.105 0 0 0-2.208-.001v1.556c0 .609.494 1.104 1.103 1.104zM2.658 9.92h.031a1.104 1.104 0 1 0 0-2.208h-.033h.002h-1.554a1.105 1.105 0 0 0-.001 2.208h.002zm1.024-4.677a1.104 1.104 0 1 0 1.561-1.559l-.001-.001l-1.099-1.099a1.104 1.104 0 1 0-1.561 1.559l.001.001zm10.66 12.221a1.104 1.104 0 0 0-1.561-1.559l.001-.001l-3.12 3.12a3.312 3.312 0 0 1-4.678-4.682l-.002.002l3.12-3.12a1.104 1.104 0 1 0-1.559-1.561l-.001.001l-3.12 3.12a5.52 5.52 0 0 0 3.9 9.422h.013a5.47 5.47 0 0 0 3.887-1.616zm6.243-14.052a5.47 5.47 0 0 0-3.887-1.616h-.013h.001h-.013a5.47 5.47 0 0 0-3.887 1.616l-3.12 3.12a1.104 1.104 0 1 0 1.559 1.561l.001-.001l3.12-3.12a3.312 3.312 0 1 1 4.683 4.679l-.002.002l-3.12 3.12a1.104 1.104 0 1 0 1.559 1.561l.001-.001l3.12-3.12c.996-.999 1.611-2.378 1.611-3.9s-.616-2.901-1.612-3.9z" />
        )}
      </svg>
    </span>
  );
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
        <ConnectionStatus />
        <h1 id="chat-title">{session?.title || "新对话"}</h1>
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
            <Icon name="workspace" />
          </button>
        </span>
      </div>
    </div>
  );
}
