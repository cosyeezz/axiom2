import { useEffect, useRef, type ReactNode } from "react";
import sprite from "./icons.svg?raw";

export function Icons() {
  return (
    <div aria-hidden="true" dangerouslySetInnerHTML={{ __html: sprite }} />
  );
}
export function Icon({ name }: { name: string }) {
  return (
    <svg aria-hidden="true">
      <use href={`#i-${name}`} />
    </svg>
  );
}
export function PanelIcon() {
  return (
    <svg className="sidebar-motion" viewBox="0 0 24 24" aria-hidden="true">
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
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  className?: string;
  describedBy?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
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
      className={className}
      aria-label={title}
      aria-describedby={describedBy}
      onKeyDown={(e) => e.stopPropagation()}
      onCancel={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }}
    >
      <h2>{title}</h2>
      {children}
    </dialog>
  );
}
export function SettingsSidebar({ page }: { page: "overview" | "models" | "tools" }) {
  return (
    <aside className="settings-sidebar" aria-label="配置导航">
      <a className="btn btn-ghost back-link" href="/">
        <svg aria-hidden="true" viewBox="0 0 24 24">
          <path d="m12 5-7 7 7 7M5 12h15" />
        </svg>
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
      </nav>
      <p className="sidebar-note">
        AXIOM · 本地配置
        <br />
        配置与工作空间独立
      </p>
    </aside>
  );
}
