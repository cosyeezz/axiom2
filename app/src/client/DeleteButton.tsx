import { useEffect, useRef } from "react";
import { DeleteIcon } from "./DeleteIcon.js";

/** Leave the trigger available for the second click before opening a modal. */
export function DeleteButton({ label, title, className = "icon-btn", disabled = false,
  onConfirm, onDelete, onPendingChange }: {
  label: string;
  title: string;
  className?: string;
  disabled?: boolean;
  onConfirm: () => void;
  onDelete: () => void;
  onPendingChange?: (pending: boolean) => void;
}) {
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const clearTimer = () => {
    clearTimeout(timer.current);
    timer.current = undefined;
  };
  const cancel = () => {
    clearTimer();
    onPendingChange?.(false);
  };
  useEffect(() => {
    if (disabled) cancel();
    return clearTimer;
  }, [disabled]);
  useEffect(() => {
    const hide = () => { if (document.visibilityState !== "visible") cancel(); };
    // Window blur can leave the trigger as activeElement without a button blur.
    window.addEventListener("blur", cancel);
    document.addEventListener("visibilitychange", hide);
    return () => {
      window.removeEventListener("blur", cancel);
      document.removeEventListener("visibilitychange", hide);
    };
  }, [onPendingChange]);
  return (
    <button type="button" className={className} disabled={disabled}
      aria-label={label} data-tooltip={`${title}（单击确认，双击直接删除）`}
      onBlur={cancel}
      onKeyDown={(event) => {
        if (event.key === "Escape") cancel();
      }}
      onPointerCancel={cancel}
      onPointerDown={(event) => {
        // Keep a held second press from opening the modal before its click.
        if (event.button === 0 && event.detail > 1) clearTimer();
      }}
      onClick={(event) => {
        event.stopPropagation();
        if (disabled || event.detail > 1) return;
        cancel();
        if (event.detail === 0) {
          onConfirm();
          return;
        }
        onPendingChange?.(true);
        const trigger = event.currentTarget;
        trigger.focus({ preventScroll: true });
        timer.current = setTimeout(() => {
          timer.current = undefined;
          // Do not open a stale confirmation after navigation or focus changes.
          if (trigger.isConnected && !trigger.disabled && document.activeElement === trigger &&
              document.hasFocus() && document.visibilityState === "visible")
            onConfirm();
          onPendingChange?.(false);
        }, 500);
      }}
      onDoubleClick={(event) => {
        event.stopPropagation();
        clearTimer();
        if (!disabled) onDelete();
        onPendingChange?.(false);
      }}>
      <DeleteIcon />
    </button>
  );
}
