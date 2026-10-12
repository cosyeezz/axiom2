import { useRef, useState } from "react";
import { command } from "../transport.js";
import { clearSubmittedDraft } from "../drafts.js";
import { scopeKey, type Draft, type Scope } from "../../shared/protocol.js";

// A request belongs to the captured session/draft even if its receipt arrives after navigation.
export function useSubmission(
  scope: Scope,
  draft: Draft,
  state: {
    active: boolean;
    nested: boolean;
    selected: boolean;
    connected: boolean;
    runId?: string;
  },
) {
  const key = `pending:${scopeKey(scope)}`;
  const inFlight = useRef(false);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [uncertain, setUncertain] = useState(() => {
    try {
      return JSON.parse(sessionStorage.getItem(key) || "null")?.requestId ?? "";
    } catch {
      return "";
    }
  });
  async function submit(op = "prompt") {
    const stopping = state.active && op === "prompt";
    if (
      inFlight.current ||
      !state.connected ||
      (!stopping && uncertain) ||
      (!state.active && !state.selected)
    )
      return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    const requestId = crypto.randomUUID(),
      captured = { text: draft.text, attachment: draft.attachment };
    let sent = false;
    try {
      if (!stopping)
        sessionStorage.setItem(
          key,
          JSON.stringify({
            requestId,
            op: op === "append" ? "prompt" : op,
            ...captured,
          }),
        );
      sent = true;
      await command(
        stopping ? "agent.stop" : op === "append" ? "prompt" : op,
        stopping
          ? { runId: state.runId }
          : op === "agent.continue"
            ? {}
            : { ...captured, ...(state.nested ? { mode: "steer" } : {}) },
        scope,
        requestId,
      );
      if (!stopping && op !== "agent.continue")
        clearSubmittedDraft(scope, captured);
      if (!stopping) sessionStorage.removeItem(key);
    } catch (e) {
      if (!stopping && (e as { code?: string }).code === "UNCERTAIN")
        setUncertain(requestId);
      else if (!stopping) {
        try {
          sessionStorage.removeItem(key);
        } catch {}
      }
      setError(
        sent
          ? (e as Error).message
          : "浏览器恢复记录无法保存，未发送任务。请检查浏览器存储。",
      );
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  async function reconcile() {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    try {
      const receipt = await command<{ status: string }>(
        "agent.receipt",
        { requestId: uncertain },
        scope,
      );
      setError(`请求状态：${receipt.status}。不会自动重发。`);
      if (["committed", "failed", "not_found"].includes(receipt.status)) {
        const pending = JSON.parse(sessionStorage.getItem(key) || "null");
        if (receipt.status === "committed" && pending?.op === "prompt")
          clearSubmittedDraft(scope, pending);
        sessionStorage.removeItem(key);
        setUncertain("");
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  return { busy, error, setError, uncertain, submit, reconcile };
}
