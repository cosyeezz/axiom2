import { useEffect, useState } from "react";
import type { GitBranchInfo } from "../../shared/git.js";
import type { Workspace } from "../../shared/protocol.js";
import { Icon } from "../Icon.js";
import { command, useConnectionState } from "../transport.js";

/** Mounted only beside the top conversation title, never in the history sidebar. */
export function GitBranchBadge({ workspace }: { workspace?: Workspace }) {
  const { connected, generation } = useConnectionState();
  const [branch, setBranch] = useState<GitBranchInfo | null>(null);
  const id = workspace?.id, path = workspace?.path, authorized = workspace?.authorized;
  useEffect(() => {
    setBranch(null);
    if (!id || !authorized || !connected) return;
    const controller = new AbortController();
    let disposed = false, reading = false;
    const refresh = async () => {
      if (reading || document.visibilityState !== "visible") return;
      reading = true;
      try {
        const result = await command<GitBranchInfo | null>("git.branch", {}, { workspaceId: id }, undefined, controller.signal);
        if (!disposed) setBranch(result);
      } catch { if (!disposed) setBranch(null); }
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
  if (!connected || !authorized || !branch) return null;
  const label = branch.detached ? `Git 游离状态：${branch.name}` : `当前 Git 分支：${branch.name}`;
  return <span className="git-branch-badge" role="status" aria-label={label} data-tooltip={label}>
    <Icon name="git-branch" />
    <span className="git-branch-name">{branch.detached ? `游离 · ${branch.name}` : branch.name}</span>
  </span>;
}
