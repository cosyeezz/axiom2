import { useEffect, useState } from "react";
import type { GitBranchInfo } from "../../shared/git.js";
import type { Workspace } from "../../shared/protocol.js";
import { Icon } from "../Icon.js";
import { command, useConnectionState } from "../transport.js";

// The cache is tab-local and scoped to both workspace identity and path. Reuse
// only confirmed metadata on reload; the Git request still revalidates it.
function branchCacheKey(id: string, path: string) {
  return `axiom.git-branch:${JSON.stringify([id, path])}`;
}
function readBranchCache(workspace?: Workspace): GitBranchInfo | null {
  if (!workspace?.authorized) return null;
  try {
    const value = JSON.parse(sessionStorage.getItem(branchCacheKey(workspace.id, workspace.path)) || "null");
    return value && typeof value.name === "string" && value.name.length > 0 && typeof value.detached === "boolean"
      ? { name: value.name, detached: value.detached } : null;
  } catch { return null; }
}
function writeBranchCache(id: string, path: string, value: GitBranchInfo | null) {
  try {
    const key = branchCacheKey(id, path);
    if (value) sessionStorage.setItem(key, JSON.stringify(value));
    else sessionStorage.removeItem(key);
  } catch { /* Storage may be unavailable; live Git metadata must still work. */ }
}

function CopyBranch({ branch }: { branch: GitBranchInfo }) {
  const { name, detached } = branch;
  const label = detached ? `Git 游离状态：${name}` : `当前 Git 分支：${name}`;
  const [state, setState] = useState<"" | "copying" | "copied" | "failed">("");
  useEffect(() => {
    if (state !== "copied") return;
    const timer = setTimeout(() => setState(""), 1500);
    return () => clearTimeout(timer);
  }, [state]);
  const feedback = state === "copying" ? "正在复制…" : state === "copied" ? "已复制分支名" : state === "failed" ? "复制失败，点击重试" : "";
  return <button type="button" className="git-branch-badge" aria-label="复制分支名" aria-description={label}
    data-tooltip={feedback ? undefined : `${label} · 点击复制`} disabled={state === "copying"} onClick={async () => {
      setState("copying");
      try { await navigator.clipboard.writeText(name); setState("copied"); }
      catch { setState("failed"); }
    }}>
    <Icon name="git-branch" />
    <span className="git-branch-name">{detached ? `游离 · ${name}` : name}</span>
    <span className="branch-copy-feedback" aria-hidden="true">{feedback}</span>
    <span className="screen-reader" role="status">{feedback}</span>
  </button>;
}

/** Mounted only before the workspace path in the conversation header, never in the history sidebar. */
export function GitBranchBadge({ workspace }: { workspace?: Workspace }) {
  const { connected, generation } = useConnectionState();
  const [branch, setBranch] = useState<GitBranchInfo | null>(() => readBranchCache(workspace));
  const id = workspace?.id, path = workspace?.path, authorized = workspace?.authorized;
  useEffect(() => {
    setBranch(readBranchCache(workspace));
    if (!id || !path || !authorized || !connected) return;
    const controller = new AbortController();
    let disposed = false, reading = false;
    const refresh = async () => {
      if (reading || document.visibilityState !== "visible") return;
      reading = true;
      try {
        const result = await command<GitBranchInfo | null>("git.branch", {}, { workspaceId: id }, undefined, controller.signal);
        if (!disposed) { writeBranchCache(id, path, result); setBranch(result); }
      } catch {
        if (!disposed) { writeBranchCache(id, path, null); setBranch(null); }
      }
      finally { reading = false; }
    };
    const resume = () => { void refresh(); };
    resume();
    const timer = window.setInterval(resume, 5000);
    window.addEventListener("focus", resume);
    document.addEventListener("visibilitychange", resume);
    return () => {
      disposed = true; controller.abort(); window.clearInterval(timer);
      window.removeEventListener("focus", resume);
      document.removeEventListener("visibilitychange", resume);
    };
  }, [id, path, authorized, connected, generation]);
  if (!authorized || !branch) return null;
  return <CopyBranch key={`${branch.detached}:${branch.name}`} branch={branch} />;
}
