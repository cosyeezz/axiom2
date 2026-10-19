import { useId, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useSettingsPopover } from "../useSettingsPopover.js";
import { Icon } from "../Icon.js";

/** Statistics share the toolbar's accessible, non-modal detail sheet. */
export function MetricDetail({ trigger, title, subtitle, className = "", children, footer, onClose }: {
  trigger: HTMLButtonElement; title: string; subtitle?: string; className?: string;
  children: ReactNode; footer?: ReactNode; onClose: () => void;
}) {
  const { panel, close, host } = useSettingsPopover(trigger, onClose, "anchored"), id = useId();
  return createPortal(<dialog ref={panel} open popover="auto" className={`metric-detail toolbar-detail-panel ${className}`} aria-labelledby={id}>
    <header className="toolbar-detail-header"><div><h2 id={id}>{title}</h2>{subtitle && <p>{subtitle}</p>}</div><button ref={close} type="button" className="icon-btn" aria-label="关闭统计详情" onClick={onClose}><Icon name="close" /></button></header>
    <div className="toolbar-detail-body metric-detail-body">{children}</div>
    {footer && <footer className="toolbar-detail-footer">{footer}</footer>}
  </dialog>, host);
}
