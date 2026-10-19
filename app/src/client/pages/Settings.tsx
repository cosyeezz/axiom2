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
            <p>集中管理模型与工具，设置不随工作空间切换。</p>
          </div>
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
            <a className="log-row module-row" href="/tools.html">
              <div>
                <h3>内置工具</h3>
                <p>安装、配置与更新 OpenCLI 等工具</p>
              </div>
              <span className="meta">浏览器与网站操作</span>
              <Icon name="chevron-right" />
            </a>
            <PhoneConnect />
            <p className="overview-message" role={config.error ? "alert" : "status"}>
              {config.error ||
                (config.revision
                  ? `${connection} · ${config.available.length} 个模型可用。实际调用结果以供应商响应为准。`
                  : `${connection} · 正在读取配置…`)}
            </p>
          </section>
          <section className="overview-section" aria-labelledby="scope-heading">
            <h2 id="scope-heading">存储与隐私</h2>
            <dl className="scope-list">
              <div className="scope-row">
                <dt>配置作用域</dt>
                <dd>本机应用 · 不随工作空间切换</dd>
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
                  {config.dataRoot || "等待服务提供目录"}
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
