import { LocalPath } from "../LocalPath.js";
import { Icon, SettingsSidebar } from "../components.js";
import { SettingsHeader } from "../settings/SettingsHeader.js";
import { PhoneConnect } from "../settings/PhoneConnect.js";
import { useConnection, useScope } from "../transport.js";
import type { Configuration } from "../../shared/protocol.js";
import "../styles/settings.css";
const empty: Configuration = {
  revision: "",
  providerCount: 0,
  modelCount: 0,
  available: [],
  dataRoot: "",
};

export default function Settings() {
  const config = useScope("configuration", empty),
    connection = useConnection();
  return (
    <div className="settings-app">
      <SettingsSidebar page="overview" />
      <main className="settings-main settings-overview-main" id="content">
        <SettingsHeader page="overview" />
        <div className="container">
          <div className="overview-intro">
            <h1>配置</h1>
            <p>集中管理模型与工具，技能和 MCP 可按全局或项目分别配置。</p>
          </div>
          <section className="overview-section" aria-label="通用设置">
            <a className="log-row module-row" href="/display.html">
              <div><h3>显示与阅读</h3><p>字体、字号与间距、亮度和对比度</p></div>
              <span className="meta">当前设备</span><Icon name="chevron-right" />
            </a>
          </section>
          <section
            className="overview-section"
            aria-labelledby="module-heading"
          >
            <h2 id="module-heading">AI 与连接</h2>
            <a className="log-row module-row" href="/model-config.html">
              <div>
                <h3>模型服务</h3>
                <p>管理供应商、接口地址、认证与模型列表</p>
              </div>
              <span className="meta" id="model-config-summary">
                {config.error
                  ? "配置读取失败"
                  : config.revision
                    ? `${config.providerCount} 个供应商 · ${config.modelCount} 个模型`
                    : "正在读取配置…"}
              </span>
              <Icon name="chevron-right" />
            </a>
            <a className="log-row module-row" href="/model-accounts.html">
              <div><h3>多账号管理</h3><p>管理同一供应商的多个账号，快速切换并查看官方额度；单账号在模型服务中管理</p></div>
              <span className="meta">账号管理</span><Icon name="chevron-right" />
            </a>
            <a className="log-row module-row" href="/model-usage.html">
              <div><h3>模型用量与统计</h3><p>本地调用用量、预计费用与独立账号的上游额度查询</p></div>
              <span className="meta">统计与用量授权</span><Icon name="chevron-right" />
            </a>
            <a className="log-row module-row" href="/resources.html">
              <div><h3>技能与 MCP</h3><p>按全局或项目管理技能内容、MCP 配置与安装来源</p></div>
              <span className="meta">资源与连接</span><Icon name="chevron-right" />
            </a>
            <a className="log-row module-row" href="/tools.html">
              <div>
                <h3>内置工具</h3>
                <p>安装、配置与更新 OpenCLI 等工具</p>
              </div>
              <span className="meta">浏览器与网站操作</span>
              <Icon name="chevron-right" />
            </a>
            <p className="overview-message" role={config.error ? "alert" : "status"}>
              {config.error || config.warning ||
                (config.revision
                  ? `${connection} · ${config.available.length} 个模型可用。实际调用结果以供应商响应为准。`
                  : `${connection} · 正在读取配置…`)}
            </p>
          </section>
          <PhoneConnect />
          <section className="overview-section" aria-labelledby="scope-heading">
            <h2 id="scope-heading">存储与隐私</h2>
            <dl className="scope-list">
              <div className="scope-row">
                <dt>配置作用域</dt>
                <dd>模型与内置工具为本机应用级；技能和 MCP 支持全局及项目范围</dd>
              </div>
              <div className="scope-row">
                <dt>供应商与模型</dt>
                <dd>与终端 pi 共享 <code>models.json</code>，保存后生效</dd>
              </div>
              <div className="scope-row">
                <dt>API 密钥</dt>
                <dd>
                  保存在服务端 <code>auth.json</code>；已保存的密钥不回传页面，也不写入浏览器存储
                </dd>
              </div>
              <div className="scope-row">
                <dt>服务连接</dt>
                <dd>{connection}</dd>
              </div>
              <div className="scope-row">
                <dt>数据目录</dt>
                <dd>
                  {config.dataRoot ? <LocalPath path={config.dataRoot} /> : "等待服务提供目录"}
                </dd>
              </div>
            </dl>
          </section>
          <p className="overview-footnote">
            工作空间、会话与聊天草稿保存在应用数据目录；重新打开可恢复已保存草稿，首次发送时才启动代理。
          </p>
        </div>
      </main>
    </div>
  );
}
