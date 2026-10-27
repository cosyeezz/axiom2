// Generic renderer fixture: no backend, native bridge or update source.
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { Icons } from "../../src/client/components.js";
import { Icon } from "../../src/client/Icon.js";
import SystemNotifications, { type SystemNotice } from "../../src/client/pages/SystemNotification.js";
import "../../src/client/styles/tokens.css";
import "../../src/client/styles/icon-geometry.css";
import "../../src/client/styles/connect.css";
import "../../src/client/styles/theme.css";

function Fixture() {
  const [dismissed, setDismissed] = useState<string[]>([]);
  const [viewed, setViewed] = useState(0);
  const dismiss = (id: string) => setDismissed(current => [...current, id]);
  const items: SystemNotice[] = [
    { id: "resource-sync", icon: <Icon name="check" className="system-notification-icon" />, message: "资源同步完成",
      action: { label: "查看记录", onClick: () => setViewed(value => value + 1) }, dismiss: { label: "关闭同步通知", onClick: () => dismiss("resource-sync") } },
    { id: "maintenance", icon: <Icon name="server" className="system-notification-icon" />, message: "维护任务等待确认",
      action: { label: "等待确认", disabled: true, title: "尚未确认", onClick: () => { throw Error("disabled action must not run"); } },
      dismiss: { label: "关闭维护通知", onClick: () => dismiss("maintenance") } },
  ];
  return <><div className="desktop-icon-definitions" aria-hidden="true"><Icons /></div>
    <nav className="desktop-workbench-bar" style={{ height: 48 }}><div className="desktop-workbench-left"><SystemNotifications leading={{ id: "connection", content: <span className="desktop-workbench-status" data-state="connected">后台服务已连接</span> }} items={items.filter(item => !dismissed.includes(item.id))} /></div></nav>
    <output aria-label="已查看次数">{viewed}</output>
  </>;
}
createRoot(document.getElementById("root")!).render(<Fixture />);
