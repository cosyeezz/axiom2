import { useState } from "react";
import { command, useScope } from "../transport.js";
import { Dialog, Icon } from "../components.js";
import {
  scopeKey,
  type Scope,
  type Session,
  type Workspace,
} from "../../shared/protocol.js";
export function OpenFolder({
  close,
  opened,
}: {
  close: () => void;
  opened: (w: Workspace) => void;
}) {
  const [path, setPath] = useState(""),
    [authorized, setAuthorized] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <Dialog title="打开工作空间" onClose={close}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            opened(
              await command<Workspace>("workspace.open", { path, authorized }),
            );
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <p>
          输入本地服务可访问的项目绝对路径。浏览器上传文件不等于打开工作空间。
        </p>
        <div className="field">
          <label htmlFor="workspace-path">项目目录</label>
          <input
            autoFocus
            className="input"
            id="workspace-path"
            value={path}
            onChange={(e) => setPath(e.target.value)}
            required
            maxLength={4096}
            placeholder="例如 F:\项目 或 /home/user/project"
          />
        </div>
        <label>
          <input
            type="checkbox"
            required
            checked={authorized}
            onChange={(e) => setAuthorized(e.target.checked)}
          />
          授权编码工具访问此项目。上下文隔离不是文件系统沙箱；项目扩展仍需单独授权。
        </label>
        <p className="workspace-error" role="alert">
          {error}
        </p>
        <div className="row">
          <button type="button" className="btn btn-ghost" onClick={close}>
            取消
          </button>
          <button className="btn" disabled={busy || !authorized}>
            {busy ? "正在确认…" : "打开文件夹"}
          </button>
        </div>
      </form>
    </Dialog>
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
  const session = useScope<Session | null>(
    scope?.sessionId ? scopeKey(scope) : null,
    null,
  );
  return (
    <div className="title-block">
      <h1 id="chat-title">{session?.title || "新对话"}</h1>
      <div className="title-meta">
        <span id="title-path" title={workspace?.path}>
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
            disabled={!workspace}
            aria-label="打开系统文件管理器"
            onClick={async () => {
              const response = await fetch(
                `/api/workspace/reveal?id=${workspace!.id}`,
                { method: "POST" },
              );
              if (!response.ok) onError("无法打开系统文件管理器");
            }}
          >
            <Icon name="workspace" />
          </button>
        </span>
      </div>
    </div>
  );
}
