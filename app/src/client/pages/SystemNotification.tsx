import type { ReactNode } from "react";
import { Icon } from "../Icon.js";
import "../styles/system-notification.css";

export type SystemNotice = {
  id: string;
  icon?: ReactNode;
  message: ReactNode;
  action?: { label: string; onClick: () => void; disabled?: boolean; title?: string; className?: string };
  dismiss?: { label: string; onClick: () => void; disabled?: boolean };
};

// An existing status can stay untouched in the leading slot. Only appended
// notifications scroll; they never resize or replace the original controls.
export default function SystemNotifications({ leading, items }: { leading?: { id: string; content: ReactNode }; items: readonly SystemNotice[] }) {
  return <div className="system-notifications" role="list" aria-label="系统通知">
    {leading && <div className="system-notification system-notification-leading" data-kind={leading.id} role="listitem">{leading.content}</div>}
    {items.length > 0 && <div className="system-notifications-following" role="group" aria-label="新增系统通知，可左右滚动" tabIndex={0} aria-live="polite">{items.map(item => <div key={item.id} className="system-notification" data-kind={item.id} role="listitem" aria-atomic="true">
      {item.icon}
      <span className="system-notification-message">{item.message}</span>
      {item.action && <button type="button" className={`system-notification-action ${item.action.className || ""}`} disabled={item.action.disabled} title={item.action.title} onClick={item.action.onClick}>{item.action.label}</button>}
      {item.dismiss && <button type="button" className="system-notification-close" aria-label={item.dismiss.label} disabled={item.dismiss.disabled} onClick={item.dismiss.onClick}><Icon name="x" /></button>}
    </div>)}</div>}
  </div>;
}
