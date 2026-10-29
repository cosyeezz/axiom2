import { useEffect, useId, useLayoutEffect, useRef, useState, type ButtonHTMLAttributes, type ReactNode, type Ref } from "react";
import { Icon } from "../Icon.js";
import { resolveComponentActions, type ComponentActionCapability, type ComponentActionContext, type ComponentActionState } from "../../shared/component-actions.js";
import { ComponentActionGlyph, ComponentGlyph, ComponentKindGlyph, type ComponentKind } from "./ComponentGlyph.js";
import "../styles/maintenance.css";

/** Recursive presentation data. Operations still belong to the real installer. */
export type ComponentEnvironment = ComponentCardProps & { id: string };
export type ComponentCardProps = {
  label: string;
  headingId?: string;
  regionLabel?: string;
  className?: string;
  busy?: boolean;
  description?: string;
  kind?: ComponentKind;
  version?: string;
  availableVersion?: string;
  availableVersionLabel?: string;
  location?: ReactNode;
  status?: string;
  summary?: ReactNode;
  actions?: ReactNode;
  details?: ReactNode;
  /** Fold only supporting information; actions, tasks and feedback stay visible. */
  secondaryLabel?: string;
  environment?: readonly ComponentEnvironment[];
  /** Transport-backed children use the same card without losing their task owner. */
  environmentContent?: ReactNode;
  children?: ReactNode;
  feedback?: ReactNode;
  maintenance?: ReactNode;
};

/** Temporary blockers remain focusable and can explain themselves on touch/keyboard.
 * Unsupported or meaningless capabilities are omitted by ComponentActions, not CSS.
 */
export function ComponentAction({ label, icon, primary = false, danger = false, className = "", ref, disabled, disabledReason, ...props }: Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children" | "aria-label"> & { label: string; icon: string; primary?: boolean; danger?: boolean; disabledReason?: string; ref?: Ref<HTMLButtonElement> }) {
  const reasonId = useId(), [explaining, setExplaining] = useState(false);
  const blocked = !!disabled || props["aria-disabled"] === true || props["aria-disabled"] === "true";
  const reason = blocked ? disabledReason || props.title || "操作暂不可用，请查看组件说明。" : undefined;
  const tooltip = [label, props.title, reason].filter((part, index, all) => part && all.indexOf(part) === index).join(" · ");
  return <><button {...props} ref={ref} type={props.type ?? "button"} className={`maintenance-icon-button component-action${primary ? " is-primary" : ""}${danger ? " is-danger" : ""} ${className}`.trim()} aria-label={label} aria-disabled={blocked || undefined} aria-describedby={[props["aria-describedby"], reason ? reasonId : undefined].filter(Boolean).join(" ") || undefined} data-tooltip={tooltip}
    onClick={event => { if (blocked) { event.preventDefault(); setExplaining(true); } else props.onClick?.(event); }}
    onBlur={event => { setExplaining(false); props.onBlur?.(event); }} onKeyDown={event => { if (event.key === "Escape") setExplaining(false); props.onKeyDown?.(event); }}>
    <ComponentActionGlyph name={icon} /><span className="component-action-label">{label}</span>
  </button>{reason && <span id={reasonId} className="component-action-reason" role="status" hidden={!explaining}>{reason}</span>}</>;
}

/** Adapters provide capabilities and handlers; recursive cards never know component IDs. */
export function ComponentActions({ capabilities, context, onAction }: { capabilities: readonly (ComponentActionCapability & { execute: () => void; buttonRef?: Ref<HTMLButtonElement> })[]; context: ComponentActionContext; onAction?: (action: ComponentActionState) => void }) {
  return <>{resolveComponentActions(capabilities, context).map(action => {
    const capability = capabilities.find(item => item.id === action.id)!;
    return <ComponentAction key={action.id} ref={capability.buttonRef} label={action.label} icon={action.icon} primary={action.primary} danger={action.danger} disabled={!action.available} disabledReason={action.reason} data-component-action={action.id} onClick={() => { capability.execute(); onAction?.(action); }} />;
  })}</>;
}

/** A movable surface. Outer kind glyph spans name/path; grouped glyphs follow the group title size. */
export function ComponentCard({ label, headingId, regionLabel, className = "", busy, description, kind = "component", version, availableVersion, availableVersionLabel = "推荐", location, status, summary, environment, environmentContent, actions, details, secondaryLabel, children, feedback, maintenance }: ComponentCardProps) {
  const generatedHeading = useId(), heading = headingId ?? generatedHeading;
  const title = useRef<HTMLHeadingElement>(null), focusedAction = useRef<HTMLElement | null>(null);
  // Unsupported or meaningless actions may disappear. Keep focus on this card
  // rather than the document body; temporary blockers retain their focusable slot.
  useLayoutEffect(() => {
    const last = focusedAction.current;
    if (last && (!last.isConnected || (last as HTMLButtonElement).disabled) && (document.activeElement === document.body || document.activeElement === null)) { focusedAction.current = null; title.current?.focus({ preventScroll: true }); }
  });
  const statusNote = status && status !== version ? status : undefined;
  const supportingInfo = <>
    {description && <p id={`${heading}-description`} className="component-card-description">{description}</p>}
    {details && <div className="component-card-notes">{details}</div>}
  </>;
  const environmentView = (!!environment?.length || environmentContent) && <section className="component-environment" aria-labelledby={`${heading}-environment`}>
    <h4 id={`${heading}-environment`} className="component-environment-heading"><ComponentGlyph name="environment" />环境</h4>
    <div className="component-environment-cards">
      {environment?.map(({ id, ...component }) => <ComponentCard key={id} {...component} />)}
      {environmentContent}
    </div>
  </section>;
  return <section className={`section tools-section maintenance-panel component-card ${className}`.trim()} data-component-kind={kind} aria-label={regionLabel ?? `${label}维护`} aria-busy={busy} aria-describedby={description ? `${heading}-description` : undefined}>
    <div className="maintenance-panel-heading">
      <div className="maintenance-panel-title"><span className="maintenance-resource-icon"><ComponentKindGlyph kind={kind} /></span><div className="component-card-identity">
        <div className="component-card-name-row">
          <h3 ref={title} id={heading} title={label} tabIndex={-1}>{label}</h3>
          {actions && <div className="component-actions" role="group" aria-label={`${label}操作`} onFocus={event => { focusedAction.current = event.target as HTMLElement; }} onBlur={event => { const node = event.target as HTMLElement; if (node.isConnected && !(node as HTMLButtonElement).disabled) focusedAction.current = null; }}>{actions}</div>}
        </div>
        {location && <div className="component-card-location">{typeof location === "string" ? <span className="component-card-location-text" title={location}>{location}</span> : location}</div>}
      </div></div>
      {(version || availableVersion) && <div className="component-card-versions">
        {version && <span className="component-card-version"><span className="component-version-label">当前</span> <span className="component-version-value">{version}</span></span>}
        {availableVersion && <span className="component-card-candidate"><span className="component-version-label">{availableVersionLabel}</span> <span className="component-version-value">{availableVersion}</span></span>}
      </div>}
    </div>
    {statusNote && <p className="maintenance-note component-card-status">{statusNote}</p>}
    {!secondaryLabel && supportingInfo}
    {summary && <div className="component-card-summary">{summary}</div>}
    {secondaryLabel && <details className="component-secondary"><summary><span>{secondaryLabel}</span><Icon name="chevron-down" /></summary>{supportingInfo}{environmentView}</details>}
    <div className="maintenance-resource-content">{children}</div>
    {feedback && <div className="component-card-feedback" aria-live="polite">{feedback}</div>}
    {maintenance}
    {!secondaryLabel && environmentView}
  </section>;
}

/** Inline confirmation; never opens a dialog or invokes an action on cancellation. */
export function ComponentConfirmation({ title, description, warning, children, confirmLabel, cancelLabel = "取消", danger = false, confirmDisabled = false, onConfirm, onClose }: {
  title: string; description: ReactNode; warning?: string; children?: ReactNode;
  confirmLabel: string; cancelLabel?: string; danger?: boolean; confirmDisabled?: boolean;
  onConfirm: () => void | Promise<unknown>; onClose: () => void;
}) {
  const titleId = useId(), pending = useRef(false), surface = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const trigger = document.activeElement as HTMLElement | null, node = surface.current;
    node?.scrollIntoView({ block: "nearest" }); node?.focus({ preventScroll: true });
    return () => { if (document.activeElement === document.body || node?.contains(document.activeElement)) trigger?.focus({ preventScroll: true }); };
  }, []);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const submit = async () => {
    if (pending.current || confirmDisabled) return;
    pending.current = true; setBusy(true); setError("");
    try { await onConfirm(); onClose(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { pending.current = false; setBusy(false); }
  };
  return <div ref={surface} tabIndex={-1} className="component-confirmation inline-confirmation" role="group" aria-labelledby={titleId} aria-busy={busy}>
    <strong id={titleId}>{title}</strong>
    <div className="component-confirmation-description">{description}</div>
    {warning && <p className="maintenance-warning"><Icon name="triangle-alert" /><span>{warning}</span></p>}
    {children}
    {error && <p className="maintenance-error" role="alert">{error}</p>}
    <div className="tools-actions">
      <button type="button" className="btn" disabled={busy} onClick={() => { if (!pending.current) onClose(); }}>{cancelLabel}</button>
      <button type="button" className={`btn ${danger ? "confirm-danger" : "btn-primary"}`} disabled={busy || confirmDisabled} onClick={() => void submit()}>{busy ? "处理中…" : confirmLabel}</button>
    </div>
  </div>;
}
