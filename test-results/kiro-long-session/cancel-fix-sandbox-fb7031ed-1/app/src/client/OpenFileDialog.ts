import type { OpenDialogKind } from "../shared/open-dialog.js";
import type { PickedAttachment, Scope } from "../shared/protocol.js";
import { folderResponse } from "./workspaces/folder-response.js";

export type OpenFileDialogRequest =
  | { purpose: "workspace"; kind: "folder"; multiple: false }
  | { purpose: "resource"; kind: "mixed"; multiple: false }
  | { purpose: "path"; kind: OpenDialogKind; multiple: false }
  | { purpose: "attachment"; kind: OpenDialogKind; multiple: boolean; scope: Scope };

/** Headless Open component. Native UI is owned by the local service, never an upload input.
 * Callers retain their own trigger, draft ownership and authorization confirmation.
 */
export async function openFileDialog(options: OpenFileDialogRequest, signal: AbortSignal): Promise<PickedAttachment[]> {
  if (!["127.0.0.1", "localhost", "[::1]"].includes(location.hostname)) {
    const { remoteFileDialog } = await import("./mobile/remote-files.js");
    return remoteFileDialog(options, signal);
  }
  const timeout = new AbortController();
  const timer = window.setTimeout(() => timeout.abort(Error("选择超时，请重试。")), 125_000);
  const combined = AbortSignal.any([signal, timeout.signal]);
  try {
    if (options.purpose === "workspace") {
      const response = await fetch("/api/workspace/pick-folder", { method: "POST", signal: combined });
      const path = await folderResponse(response);
      combined.throwIfAborted();
      return path === null ? [] : [{ path, name: path, kind: "folder" }];
    }
    const endpoint = options.purpose === "resource" ? "/api/resources/pick" : options.purpose === "path" ? `/api/files/pick?${new URLSearchParams({ kind: options.kind })}` : `/api/attachments/pick?${new URLSearchParams({ ...options.scope, kind: options.kind, multiple: String(options.multiple) })}`;
    const response = await fetch(endpoint, { method: "POST", signal: combined });
    const body = await response.text();
    let result: { items?: PickedAttachment[]; error?: string };
    try { result = JSON.parse(body); }
    catch { throw Error(response.status === 404 || response.status === 405
      ? "当前服务不支持打开窗口，请重启本地服务并刷新页面。" : "系统选择器返回无效响应，请重试。"); }
    if (!response.ok) throw Error(result.error || "无法打开系统选择窗口");
    if (!Array.isArray(result.items)) throw Error("系统选择器返回无效结果，请重试。");
    combined.throwIfAborted();
    return result.items;
  } finally { window.clearTimeout(timer); }
}
