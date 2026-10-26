import { useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Dialog, Icon } from "./components.js";
import "./styles/confirm-dialog.css";

type ConfirmationAction = () => void | Promise<unknown>;

/** Shared confirmation surface. Cancelling never invokes the bound command. */
export function ConfirmDialog({ title, description, subject, warning, children, confirmLabel, cancelLabel = "取消", danger = false, confirmDisabled = false, secondaryAction, onConfirm, onClose }: {
  title: string;
  description: ReactNode;
  subject?: string;
  warning?: string;
  children?: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  danger?: boolean;
  confirmDisabled?: boolean;
  secondaryAction?: { label: string; onConfirm: ConfirmationAction };
  onConfirm: ConfirmationAction;
  onClose: () => void;
}) {
  const descriptionId = useId(), warningId = useId();
  const pending = useRef(false);
  const [busyAction, setBusyAction] = useState<"primary" | "secondary" | null>(null);
  const busy = busyAction !== null;
  const [error, setError] = useState("");
  const close = () => { if (!pending.current) onClose(); };
  const submit = async (runConfirmation: ConfirmationAction, action: "primary" | "secondary") => {
    if (pending.current || confirmDisabled) return;
    pending.current = true;
    setBusyAction(action);
    setError("");
    try {
      const result = runConfirmation();
      if (result) await result;
      onClose();
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      pending.current = false;
      setBusyAction(null);
    }
  };
  // Native showModal supplies focus containment; the portal avoids page clipping.
  return createPortal(
    <Dialog title={title} onClose={close} className={`confirm-dialog${danger ? " confirm-dialog-danger" : ""}`}
      describedBy={`${descriptionId}${warning ? ` ${warningId}` : ""}`} dismissOnBackdrop
      heading={<div className="confirm-heading">
        <span className="confirm-symbol"><Icon name={danger ? "triangle-alert" : "circle-help"} /></span>
        <h2>{title}</h2>
      </div>}>
      <div className="confirm-body">
        {subject && <p className="confirm-subject">{subject}</p>}
        <div id={descriptionId} className="confirm-description">{description}</div>
        {warning && <div id={warningId} className="confirm-warning"><Icon name="triangle-alert" /><p>{warning}</p></div>}
        {children}
        {error && <p className="confirm-error" role="alert">{error}</p>}
      </div>
      <div className="confirm-actions" aria-busy={busy}>
        <button type="button" className="btn confirm-cancel" autoFocus aria-disabled={busy} onClick={close}>{cancelLabel}</button>
        {secondaryAction && <button type="button" className="btn" disabled={confirmDisabled} aria-disabled={busy || confirmDisabled}
          onClick={() => void submit(secondaryAction.onConfirm, "secondary")}>
          {busyAction === "secondary" && <Icon name="loader-circle" className="confirm-spinner" />}
          {busyAction === "secondary" ? "处理中…" : secondaryAction.label}
        </button>}
        <button type="button" className={`btn ${danger ? "confirm-danger" : "btn-primary"}`}
          disabled={confirmDisabled} aria-disabled={busy || confirmDisabled} onClick={() => void submit(onConfirm, "primary")}>
          {busyAction === "primary" && <Icon name="loader-circle" className="confirm-spinner" />}
          {busyAction === "primary" ? "处理中…" : confirmLabel}
        </button>
      </div>
    </Dialog>, document.body,
  );
}
