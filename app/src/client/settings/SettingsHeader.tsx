import { Icon } from "../Icon.js";
type Page = "overview" | "models" | "tools";
const labels: Record<Page, string> = { overview: "概览", models: "模型服务", tools: "内置工具" };

/** The breadcrumb and mobile navigation have identical geometry on every settings page. */
export function SettingsHeader({ page }: { page: Page }) {
  return (
    <header className="topnav">
      <div className="row">
        <a className="icon-btn mobile-back" href={page === "overview" ? "/" : "/settings.html"}
          aria-label={page === "overview" ? "返回工作台" : "返回配置概览"}>
          <Icon name="arrow-left" />
        </a>
        <a className="mobile-config-link" href="/settings.html">配置</a>
        <span aria-hidden="true">/</span>
        <strong>{labels[page]}</strong>
      </div>
      <span className="tag">本机应用</span>
    </header>
  );
}
