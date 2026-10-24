import { useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Dialog } from "./components.js";
import "./styles/confirm-dialog.css";

/** Explicit confirmation only: cancelling never invokes the bound command. */
export function ConfirmDialog({ title, description, subject, confirmLabel, danger = false, secondaryAction, onConfirm, onClose }: {
  title: string;
  description: string;
  subject?: string;
  confirmLabel: string;
  danger?: boolean;
  secondaryAction?: { label: string; onConfirm: () => Promise<unknown> };
  onConfirm: () => Promise<unknown>;
  onClose: () => void;
}) {
  const descriptionId = useId();
  const pending = useRef(false);
  const [busyAction, setBusyAction] = useState<"primary" | "secondary" | null>(null);
  const busy = busyAction !== null;
  const [error, setError] = useState("");
  const close = () => { if (!pending.current) onClose(); };
  const submit = async (runConfirmation: () => Promise<unknown>, action: "primary" | "secondary") => {
    if (pending.current) return;
    pending.current = true;
    setBusyAction(action);
    setError("");
    try {
      await runConfirmation();
      onClose();
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      pending.current = false;
      setBusyAction(null);
    }
  };
  // Escape/Delete must not bubble back into a workspace menu or its row.
  // A body portal also keeps the modal independent of sidebar clipping/styles.
  return createPortal(
    <Dialog title={title} onClose={close} className="confirm-dialog" describedBy={descriptionId}>
      {subject && <p className="confirm-subject">{subject}</p>}
      <p id={descriptionId} className="confirm-description">{description}</p>
      {error && <p className="confirm-error" role="alert">{error}</p>}
      <div className="confirm-actions" aria-busy={busy}>
        <button type="button" className="btn" autoFocus aria-disabled={busy} onClick={close}>取消</button>
        {secondaryAction && <button type="button" className="btn" aria-disabled={busy}
          onClick={() => void submit(secondaryAction.onConfirm, "secondary")}>
          {busyAction === "secondary" ? "处理中…" : secondaryAction.label}
        </button>}
        <button type="button" className={`btn ${danger ? "confirm-danger" : "btn-primary"}`}
          aria-disabled={busy} onClick={() => void submit(onConfirm, "primary")}>
          {busyAction === "primary" ? "处理中…" : confirmLabel}
        </button>
      </div>
    </Dialog>, document.body,
  );
}
