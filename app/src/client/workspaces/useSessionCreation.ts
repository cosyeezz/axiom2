import { useRef, useState, type RefObject } from "react";
import { AppError, scopeKey, type Scope, type Session } from "../../shared/protocol.js";
import { command, scopeAuthority } from "../transport.js";
import { getDraft, updateDraft } from "../drafts.js";
import { paintFeedback } from "../paint-feedback.js";

type Creation = { workspaceId: string; requestId: string; startedAt: number; preview: boolean; state: "pending" | "uncertain"; text: string };
const draftKey = (id: string) => `axiom.new-session-draft:${id}`;
function readText(id: string) { try { return sessionStorage.getItem(draftKey(id)) ?? ""; } catch { return ""; } }

/** A local new-conversation surface, not a fictitious server scope. Never sends
 * subscriptions, prompts or durable navigation preferences with a temporary ID. */
export function useSessionCreation({ view, navigation, select, onError }: {
  view: Scope | null;
  navigation: RefObject<number>;
  select: (scope: Scope, isCurrent: () => boolean) => void;
  onError: (message: string) => void;
}) {
  const requests = useRef(new Map<string, Creation>());
  const [, render] = useState(0);
  const refresh = () => render(n => n + 1);
  const preparing = [...requests.current.values()].find(request => request.preview && request.startedAt === navigation.current);
  const complete = (request: Creation, session: Session) => {
    const text = request.text;
    if (text) {
      const scope = { workspaceId: session.workspaceId, sessionId: session.id };
      const existing = getDraft(scope).text;
      updateDraft(scope, { text: existing ? `${existing}\n\n${text}` : text });
      try { sessionStorage.removeItem(draftKey(request.workspaceId)); } catch { /* The input is already in the real draft. */ }
    }
    requests.current.delete(request.workspaceId);
    if (navigation.current === request.startedAt) {
      const focus = request.preview && document.activeElement?.id === "prompt";
      select({ workspaceId: session.workspaceId, sessionId: session.id }, () => navigation.current === request.startedAt);
      if (focus) requestAnimationFrame(() => document.getElementById("prompt")?.focus({ preventScroll: true }));
    }
    refresh();
  };
  const create = async (workspaceId: string) => {
    const existing = requests.current.get(workspaceId);
    if (existing) {
      // Reopen the same preparation after navigating away (or an uncertain
      // preview), but never submit a duplicate write or remount pristine reuse.
      if (existing.startedAt !== navigation.current || existing.state === "uncertain" && !existing.preview) {
        existing.startedAt = ++navigation.current; existing.preview = true; refresh();
      }
      return;
    }
    const session = view?.workspaceId === workspaceId && view.sessionId
      ? scopeAuthority<Session | null>(scopeKey(view)) : undefined;
    // Clicking New on the current pristine conversation must preserve its mounted
    // composer, attachments and draft while the server confirms reuseEmpty.
    const reuseCurrent = session?.title === "新对话" && session.messageCount === 0 && !session.runId && !session.activeTasks && !session.activeTaskCount;
    const request: Creation = { workspaceId, requestId: crypto.randomUUID(), startedAt: ++navigation.current, preview: !reuseCurrent, state: "pending", text: readText(workspaceId) };
    requests.current.set(workspaceId, request); refresh(); onError("");
    try {
      await paintFeedback();
      const session = await command<Session>("session.create", { reuseEmpty: true }, { workspaceId }, request.requestId);
      complete(request, session);
      return session;
    } catch (error) {
      if (error instanceof AppError && error.code === "UNCERTAIN") request.state = "uncertain";
      else requests.current.delete(workspaceId);
      // The original view and the local preparation draft were never discarded.
      onError((error as Error).message); refresh();
    }
  };
  const verify = async () => {
    if (!preparing) return;
    try {
      const receipt = await command<{ status: string; data?: Session & { message?: string } }>("request.get", { requestId: preparing.requestId }, { workspaceId: preparing.workspaceId });
      if (receipt.status === "committed" && receipt.data?.id) complete(preparing, receipt.data);
      else if (receipt.status === "failed") {
        requests.current.delete(preparing.workspaceId); refresh(); onError(receipt.data?.message ?? "新建失败，已恢复原会话。");
      } else onError("新建结果仍待确认；未重复发送。请稍后再次核实。");
    } catch (error) { onError((error as Error).message); }
  };
  return {
    create, preparing,
    pending: !!preparing || !!(view && requests.current.has(view.workspaceId)),
    verify,
    changeText: (text: string) => {
      if (!preparing) return;
      preparing.text = text;
      try { sessionStorage.setItem(draftKey(preparing.workspaceId), text); } catch { onError("新会话输入暂时只保留在本窗口，请勿刷新。"); }
      refresh();
    },
  };
}
