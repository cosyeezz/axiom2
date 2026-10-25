import { useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Dialog } from "./components.js";
import "./styles/confirm-dialog.css";

/** Explicit confirmation only: cancelling never invokes the bound command. */
export function ConfirmDialog({ title, description, subject, warning, children, confirmLabel, cancelLabel = "取消", danger = false, confirmDisabled = false, secondaryAction, onConfirm, onClose }: {
  title: string;
  description: ReactNode;
  subject?: string;
  warning?: string;
  children?: ReactNode;
  cancelLabel?: string;
  confirmDisabled?: boolean;
  confirmLabel: string;
  danger?: boolean;
  secondaryAction?: { label: string; onConfirm: () => void | Promise<unknown> };
  onConfirm: () => void | Promise<unknown>;
  onClose: () => void;
}) {
  const descriptionId = useId();
  const pending = useRef(false);
  const [busyAction, setBusyAction] = useState<"primary" | "secondary" | null>(null);
  const busy = busyAction !== null;
  const [error, setError] = useState("");
  const close = () => { if (!pending.current) onClose(); };
  const submit = async (runConfirmation: () => void | Promise<unknown>, action: "primary" | "secondary") => {
    if (pending.current || confirmDisabled) return;
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
      <div id={descriptionId} className="confirm-description">{description}</div>
      {warning && <p className="confirm-warning">{warning}</p>}
      {children}
      {error && <p className="confirm-error" role="alert">{error}</p>}
      <div className="confirm-actions" aria-busy={busy}>
        <button type="button" className="btn" autoFocus aria-disabled={busy} onClick={close}>{cancelLabel}</button>
        {secondaryAction && <button type="button" className="btn" disabled={confirmDisabled} aria-disabled={busy || confirmDisabled}
          onClick={() => void submit(secondaryAction.onConfirm, "secondary")}>
          {busyAction === "secondary" ? "处理中…" : secondaryAction.label}
        </button>}
        <button type="button" className={`btn ${danger ? "confirm-danger" : "btn-primary"}`}
          disabled={confirmDisabled} aria-disabled={busy || confirmDisabled} onClick={() => void submit(onConfirm, "primary")}>
          {busyAction === "primary" ? "处理中…" : confirmLabel}
        </button>
      </div>
    </Dialog>, document.body,
  );
}
