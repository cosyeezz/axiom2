import { useEffect, useRef, useState } from "react";
import { command } from "../transport.js";
import type { Scope } from "../../shared/protocol.js";
import type { ElementTarget, Preview } from "../../shared/preview.js";
export type View = Preview & { binding: string };
type CommentDraft = { target: ElementTarget | null; note: string };
type Pending = { id: string; op: string; submitted?: CommentDraft };
export function usePreview(scope: Scope) {
  const key = `preview:${scope.workspaceId}:${scope.sessionId}`;
  const [view, setView] = useState<View | null>(null),
    [cleanup, setCleanup] = useState<
      { id: string; pid: number; command: string }[]
    >([]);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [pending, setPending] = useState<Pending | null>(null);
  const [target, setTarget] = useState<ElementTarget | null>(null),
    [note, setNote] = useState("");
  const active = useRef(false);
  useEffect(() => {
    try {
      setPending(
        JSON.parse(sessionStorage.getItem(key + ":pending") ?? "null"),
      );
      const saved = JSON.parse(
        sessionStorage.getItem(key + ":draft") ?? "null",
      );
      if (saved) {
        setTarget(saved.target);
        setNote(saved.note);
      }
    } catch {
      setError("预览恢复信息无法读取；请检查浏览器存储。");
    }
    void load();
  }, []);
  async function load() {
    try {
      const [list, records] = await Promise.all([
        command<View[]>("preview.list", {}, scope),
        command<typeof cleanup>("preview.cleanup.get", {}, scope),
      ]);
      setCleanup(records);
      setView(list.find((v) => v.status === "running") ?? null);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  function draft(next: ElementTarget | null, text = note) {
    setTarget(next);
    setNote(text);
    try {
      sessionStorage.setItem(
        key + ":draft",
        JSON.stringify({ target: next, note: text }),
      );
    } catch {
      setError("评论草稿保存失败，请勿关闭窗口。");
    }
  }
  function clearPending() {
    sessionStorage.removeItem(key + ":pending");
    setPending(null);
  }
  function clearSubmitted(submitted?: CommentDraft) {
    if (
      submitted &&
      sessionStorage.getItem(key + ":draft") === JSON.stringify(submitted)
    )
      draft(null, "");
  }
  async function mutate<T>(
    op: string,
    params: Record<string, unknown> = {},
  ): Promise<T | null> {
    if (active.current || pending) return null;
    active.current = true;
    setBusy(true);
    setError("");
    try {
      const p: Pending = {
        id: crypto.randomUUID(),
        op,
        ...(op === "annotation.send" ? { submitted: { target, note } } : {}),
      };
      sessionStorage.setItem(key + ":pending", JSON.stringify(p));
      setPending(p);
      const result = await command<T>(
        op,
        { previewId: view?.id, ...params },
        scope,
        p.id,
      );
      clearSubmitted(p.submitted);
      clearPending();
      return result;
    } catch (e) {
      setError((e as Error).message + "；请核实操作状态，不会自动重做。");
      return null;
    } finally {
      active.current = false;
      setBusy(false);
    }
  }
  async function reconcile() {
    if (!pending || active.current) return;
    active.current = true;
    setBusy(true);
    try {
      const receipt = await command<{ status: string }>(
        pending.op === "annotation.send" ? "annotation.receipt" : "request.get",
        { requestId: pending.id },
        scope,
      );
      setError(`操作状态：${receipt.status}；不会自动重发。`);
      if (["committed", "failed", "not_found"].includes(receipt.status)) {
        if (receipt.status === "committed" && pending.op === "annotation.send")
          clearSubmitted(pending.submitted);
        clearPending();
        await load();
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      active.current = false;
      setBusy(false);
    }
  }
  return {
    view,
    setView,
    cleanup,
    busy,
    error,
    setError,
    pending,
    target,
    note,
    draft,
    load,
    mutate,
    reconcile,
  };
}
