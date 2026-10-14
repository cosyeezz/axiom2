import { useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Dialog } from "./components.js";
import "./styles/confirm-dialog.css";

/** Explicit confirmation only: cancelling never invokes the bound command. */
export function ConfirmDialog({ title, description, subject, confirmLabel, danger = false, onConfirm, onClose }: {
  title: string;
  description: string;
  subject?: string;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => Promise<unknown>;
  onClose: () => void;
}) {
  const descriptionId = useId();
  const pending = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const close = () => { if (!pending.current) onClose(); };
  const submit = async () => {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      await onConfirm();
      onClose();
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      pending.current = false;
      setBusy(false);
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
        <button type="button" className={`btn ${danger ? "confirm-danger" : "btn-primary"}`}
          aria-disabled={busy} onClick={() => void submit()}>
          {busy ? "处理中…" : confirmLabel}
        </button>
      </div>
    </Dialog>, document.body,
  );
}
