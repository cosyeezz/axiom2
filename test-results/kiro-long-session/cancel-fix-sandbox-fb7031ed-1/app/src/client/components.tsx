import { useEffect, useRef, type ReactNode } from "react";
import { Icon } from "./Icon.js";
import sprite from "./icons.svg?raw";

export function Icons() {
  return (
    <div aria-hidden="true" dangerouslySetInnerHTML={{ __html: sprite }} />
  );
}
export { Icon } from "./Icon.js";
export function PanelIcon() {
  return (
    <svg className="sidebar-motion ui-glyph" viewBox="3 4 18 16" aria-hidden="true">
      <rect className="panel-fill" x="4" y="5" width="5" height="14" rx="1" />
      <rect x="3" y="4" width="18" height="16" rx="3" />
      <path className="panel-divider" d="M9 5v14" />
      <path className="panel-arrow" d="m16 9-3 3 3 3" />
    </svg>
  );
}
export function Dialog({
  title,
  onClose,
  children,
  className = "workspace-dialog",
  describedBy,
  heading,
  dismissOnBackdrop = false,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  className?: string;
  describedBy?: string;
  heading?: ReactNode;
  dismissOnBackdrop?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const backdropPress = useRef(false);
  const outside = (event: { clientX: number; clientY: number; currentTarget: HTMLDialogElement }) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    return event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom;
  };
  useEffect(() => {
    const trigger = document.activeElement as HTMLElement;
    ref.current!.showModal();
    return () => {
      if (trigger?.isConnected) trigger.focus({ preventScroll: true });
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className={`${className} scrollable-dialog`}
      aria-label={title}
      aria-describedby={describedBy}
      onKeyDown={(e) => e.stopPropagation()}
      onPointerDown={(event) => { backdropPress.current = dismissOnBackdrop && event.target === event.currentTarget && outside(event); }}
      onPointerCancel={() => { backdropPress.current = false; }}
      onClick={(event) => {
        if (backdropPress.current && event.target === event.currentTarget && outside(event)) onClose();
        backdropPress.current = false;
      }}
      onCancel={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }}
    >
      <div className="dialog-content">
        {heading ?? <h2>{title}</h2>}
        {children}
      </div>
    </dialog>
  );
}
export function SettingsSidebar({ page }: { page: "overview" | "display" | "models" | "tools" | "resources" }) {
  return (
    <aside className="settings-sidebar" aria-label="配置导航">
      <a className="btn btn-ghost back-link" href="/">
        <Icon name="arrow-left" />
        返回工作台
      </a>
      <nav aria-label="配置模块">
        <div className="settings-brand">配置</div>
        <p className="sidebar-label">通用</p>
        <a
          href="/settings.html"
          className="settings-nav"
          aria-current={page === "overview" ? "page" : undefined}
        >
          配置概览
        </a>
        <a href="/display.html" className="settings-nav" aria-current={page === "display" ? "page" : undefined}>显示与阅读</a>
        <p className="sidebar-label">AI 与连接</p>
        <a
          href="/model-config.html"
          className="settings-nav"
          aria-current={page === "models" ? "page" : undefined}
        >
          模型服务
        </a>
        <a
          href="/tools.html"
          className="settings-nav"
          aria-current={page === "tools" ? "page" : undefined}
        >
          内置工具
        </a>
        <a href="/resources.html" className="settings-nav" aria-current={page === "resources" ? "page" : undefined}>技能与 MCP</a>
      </nav>
      <p className="sidebar-note">
        AXIOM · 本地配置
        <br />
        {page === "resources" ? "按全局或项目管理资源" : "模型与工具为本机应用级"}
      </p>
    </aside>
  );
}
