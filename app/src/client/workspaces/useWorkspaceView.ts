import { useEffect, useRef, useState } from "react";
import { command, useScope } from "../transport.js";
import type { Scope, Workspace } from "../../shared/protocol.js";

type WorkspaceView = { workspaceId: string | null; view: Scope | null };

function savedView(): WorkspaceView {
  try {
    const value: unknown = JSON.parse(sessionStorage.getItem("view") || "null");
    if (value && typeof value === "object" && "workspaceId" in value && "sessionId" in value &&
      typeof value.workspaceId === "string" && value.workspaceId && typeof value.sessionId === "string")
      return {
        workspaceId: sessionStorage.getItem("sidebarWorkspaceId") || value.workspaceId,
        view: { workspaceId: value.workspaceId, sessionId: value.sessionId },
      };
  } catch { /* Corrupt or unavailable storage cannot block workspace recovery. */ }
  return { workspaceId: null, view: null };
}

/** Sidebar workspace and viewed session are independent; server preferences never navigate an open viewer. */
export function useWorkspaceView(onError: (message: string) => void) {
  const workspaces = useScope<Workspace[] | null>("workspaces", null);
  const preferences = useScope<{ lastWorkspaceId: string | null; view?: Scope | null } | null>("workspace-preferences", null);
  const [state, setState] = useState<WorkspaceView>(savedView);
  const current = useRef(state);
  const [ready, setReady] = useState(false);
  const initialized = useRef(false);
  const navigation = useRef(0);
  const select = (next: Scope | null, changeWorkspace = true, restoredWorkspace?: string) => {
    const workspaceId = restoredWorkspace ?? (changeWorkspace ? next?.workspaceId ?? null : current.current.workspaceId);
    navigation.current++;
    current.current = { workspaceId, view: next };
    setState(current.current);
    try {
      if (next) sessionStorage.setItem("view", JSON.stringify(next));
      else sessionStorage.removeItem("view");
      if (workspaceId) sessionStorage.setItem("sidebarWorkspaceId", workspaceId);
      else sessionStorage.removeItem("sidebarWorkspaceId");
    } catch {
      onError("此窗口的查看位置无法保存；下次仍可恢复服务端记住的工作空间。");
    }
    if (workspaceId)
      void command("workspace.select", { view: next?.sessionId ? next : null }, { workspaceId })
        .catch(() => { /* Best-effort navigation preference; failure must not interrupt the current view. */ });
  };
  useEffect(() => {
    if (!workspaces || !preferences) return;
    const existing = current.current;
    const sidebarExists = workspaces.some((w) => w.id === existing.workspaceId);
    const viewExists = workspaces.some((w) => w.id === existing.view?.workspaceId);
    if (!initialized.current) {
      initialized.current = true;
      setReady(true);
      // Per-window selection wins; a fresh window restores the durable main session.
      // Older services omit view; optional session recovery must never block navigation.
      if (!existing.view && preferences.view && workspaces.some(w => w.id === preferences.view!.workspaceId)) {
        select(preferences.view, true, workspaces.find(w => w.id === preferences.lastWorkspaceId)?.id);
        return;
      }
      if (sidebarExists && viewExists) {
        void command("workspace.select", {}, { workspaceId: existing.workspaceId! })
          .catch(() => { /* Restoring a window remains usable when the background preference save fails. */ });
        return;
      }
    } else if (sidebarExists && viewExists) return;
    const fallback = workspaces.find((w) => w.id === existing.workspaceId)
      ?? workspaces.find((w) => w.id === preferences.lastWorkspaceId) ?? workspaces[0];
    if (fallback) select({ workspaceId: fallback.id, sessionId: "" });
    else if (existing.view || existing.workspaceId) select(null);
  }, [workspaces, preferences]);
  return {
    workspaces: workspaces ?? [],
    workspaceId: ready ? state.workspaceId : null,
    view: ready ? state.view : null,
    select,
    selectSession: (next: Scope) => select(next, false),
    navigation,
  };
}
