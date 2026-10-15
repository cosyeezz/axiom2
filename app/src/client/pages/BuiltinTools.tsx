import { useEffect, useState } from "react";
import { SettingsSidebar } from "../components.js";
import { command, useConnection, useConnectionState, useScope } from "../transport.js";
import { defaultOpenCliSettings, type OpenCliSettings, type OpenCliState } from "../../shared/builtin-tools.js";
import "../styles/settings.css";
import "../styles/builtin-tools.css";

const empty: OpenCliState = { ready: false, nodeVersion: "", configured: false, revision: "", settings: defaultOpenCliSettings };
function hasUpdate(latest?: string, installed?: string) {
  if (!latest || !installed) return false;
  const a = latest.split(".").map(Number), b = installed.split(".").map(Number);
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return false;
}
export default function BuiltinTools() {
  const state = useScope("builtin-tools:opencli", empty);
  const connection = useConnectionState();
  const connectionText = useConnection();
  const [draft, setDraft] = useState<{ revision: string; settings: OpenCliSettings }>();
  const [sending, setSending] = useState(false);
  const [feedback, setFeedback] = useState<{ text: string; error?: boolean; revision?: string }>();
  const settings = draft?.settings ?? state.settings;
  const busy = sending || !!state.job?.running || !connection.connected;
  const update = hasUpdate(state.latest, state.version);
  const conflict = !!draft && draft.revision !== state.revision;
  const installStatus = state.version ? `v${state.version}` : state.installationError ? "安装不完整" : state.ready ? "未安装" : state.job?.error ? "状态未知" : "等待检查";
  const notice = feedback && (!feedback.revision || feedback.revision === state.revision) ? feedback : undefined;
  useEffect(() => { setFeedback(undefined); }, [state.job?.id]);
  useEffect(() => {
    if (connection.connected) void command("opencli.get").then((value) => {
      // Preserve failed/interrupted jobs when reconnecting; explicit checks can replace them.
      if (!(value as OpenCliState).job?.error) return command("opencli.refresh");
    }).catch((error: Error) => setFeedback({ text: error.message, error: true }));
  }, [connection.connected, connection.generation]);
  const change = (patch: Partial<OpenCliSettings>) => {
    setDraft({ revision: draft?.revision ?? state.revision, settings: { ...settings, ...patch } });
    setFeedback(undefined);
  };
  async function action(op: string, params: Record<string, unknown> = {}) {
    setSending(true); setFeedback(undefined);
    try {
      const result = await command(op, params) as OpenCliState;
      if (op === "opencli.save") {
        setDraft(undefined);
        setFeedback({ text: "接入设置已保存，将在下一次 Agent 执行时加载。", revision: result.revision });
      }
    } catch (error) { setFeedback({ text: (error as Error).message, error: true }); }
    finally { setSending(false); }
  }
  const error = notice ? (notice.error ? notice.text : undefined) : state.error || state.job?.error || state.installationError;
  return (
    <div className="settings-app builtin-tools-app">
      <SettingsSidebar page="tools" />
      <main className="settings-main" id="content">
        <header className="topnav">
          <div className="row"><a className="mobile-config-link" href="/settings.html">配置</a><span className="tools-desktop-label">配置</span><span aria-hidden="true">/</span><strong>内置工具</strong></div>
          <span className="tag">本机应用</span>
        </header>
        <div className="page-heading"><div><h1>内置工具</h1><p>为 Agent 接入常用工具，在这里完成安装、配置与更新。</p></div><span className="tag">1 项工具</span></div>
        <div className="configuration-layout">
          <aside className="supplier-panel" aria-label="内置工具列表">
            <div className="supplier-toolbar"><h2>全部工具</h2></div>
            <nav className="supplier-list">
              <a className="supplier-option" href="#opencli" aria-current="true"><span><strong>OpenCLI <span className="tag">浏览器</span></strong><small>{installStatus}</small></span></a>
            </nav>
          </aside>
          <article className="supplier-detail tools-detail" id="opencli" aria-labelledby="opencli-heading">
            <div className="detail-heading row-between"><div><h2 id="opencli-heading">OpenCLI</h2><p className="meta">连接 Chrome，让 Agent 操作网页和已登录的网站。</p></div><span className="tag">{state.configured ? "已配置" : "待接入"}</span></div>
            <div className="tools-feedback" aria-live="polite">
              {error ? <p className="tools-error" role="alert">{error}</p> : <p role="status">{notice?.text || state.job?.message || connectionText}</p>}
              {!connection.connected && <p>{connectionText}；重连后读取当前操作进度。</p>}
            </div>
            <section className="section tools-section" aria-labelledby="install-heading">
              <div className="section-heading"><h3 id="install-heading">安装与更新</h3><p>官方 npm 包 · @jackwener/opencli</p></div>
              <dl className="tools-facts">
                <div><dt>运行环境</dt><dd>{state.nodeVersion ? `Node.js ${state.nodeVersion}` : "等待检查"}{state.npmVersion ? ` · npm ${state.npmVersion}` : " · npm 待检查"}</dd></div>
                <div><dt>当前版本</dt><dd>{state.version ? <code>v{state.version}</code> : installStatus}</dd></div>
                <div><dt>最新版本</dt><dd>{state.latest ? <><code>v{state.latest}</code>{update && <span className="tag">有更新</span>}</> : state.job?.kind === "check" && state.job.error ? "检查失败" : "尚未检查"}</dd></div>
              </dl>
              <div className="tools-actions">
                <button className="btn" disabled={busy} onClick={() => void action("opencli.refresh")}>检查环境</button>
                <button className="btn" disabled={busy} onClick={() => void action("opencli.check")}>检查更新</button>
                <button className="btn btn-primary" disabled={busy || !state.latest || !!draft || (!!state.version && state.version !== state.latest && !update)} onClick={() => void action("opencli.install", { version: state.latest })}>{state.job?.running && state.job.kind === "install" ? "正在安装…" : state.version ? update ? "更新 OpenCLI" : "重新安装" : "安装 OpenCLI"}</button>
              </div>
              <p className="field-help tools-help">先检查更新，再安装最新版本。使用 npm 全局安装；更新会影响本机其他使用同一 OpenCLI 的程序。安装失败时可重新检查并重试。</p>
              {state.packageRoot && <p className="tools-path">安装位置 <code>{state.packageRoot}</code></p>}
            </section>
            <section className="section tools-section" aria-labelledby="config-heading">
              <div className="section-heading"><h3 id="config-heading">接入设置</h3><p>仅对 Axiom 主 Agent 生效</p></div>
              <fieldset className="tools-fields" disabled={busy || !state.version}>
                <label className="tools-toggle"><input type="checkbox" checked={settings.enabled} onChange={(e) => change({ enabled: e.target.checked })} /><span><strong>默认加载常用技能</strong><small><code>opencli-usage</code> 与 <code>opencli-browser</code>；简介常驻，完整指南按需读取。</small></span></label>
                <div className="grid-2">
                  <div className="field"><label htmlFor="opencli-profile">Chrome 配置档案</label><input className="input" id="opencli-profile" value={settings.profile} maxLength={128} placeholder="留空使用 OpenCLI 默认选择" onChange={(e) => change({ profile: e.target.value })} /><p className="field-help">多个 Chrome 账号同时连接时，填写诊断报告中的 Profile ID 或已设置的别名。</p></div>
                  <div className="field"><label htmlFor="opencli-window">浏览器窗口</label><select className="input" id="opencli-window" value={settings.window} onChange={(e) => change({ window: e.target.value as OpenCliSettings["window"] })}><option value="foreground">前台显示</option><option value="background">后台运行</option></select><p className="field-help">后台模式仍需要 Chrome 和浏览器扩展保持运行。</p></div>
                </div>
              </fieldset>
              {conflict && <div className="tools-conflict" role="status"><p>配置已在其他窗口修改。可放弃修改并载入最新配置，或用当前输入覆盖最新设置。</p><button className="btn" disabled={busy || !state.version} onClick={() => void action("opencli.save", { ...settings, revision: state.revision })}>用当前输入保存</button></div>}
              <div className="tools-actions">
                <button className="btn btn-primary" disabled={busy || conflict || !state.version || (!draft && state.configured)} onClick={() => void action("opencli.save", { ...settings, revision: draft?.revision ?? state.revision })}>保存接入设置</button>
                {draft && <button className="btn btn-ghost" disabled={busy} onClick={() => { setDraft(undefined); setFeedback(undefined); }}>放弃修改</button>}
                <span className="meta">{draft ? "有未保存的修改" : state.configured ? "已保存 · 后续执行自动加载" : "已有安装可直接保存接入设置"}</span>
              </div>
            </section>
            <section className="section tools-section" aria-labelledby="browser-heading">
              <div className="section-heading"><h3 id="browser-heading">浏览器扩展与连接</h3></div>
              <ol className="tools-steps"><li>从官方发布页下载 Browser Bridge 扩展并解压。</li><li>在 Chrome 打开 <code>chrome://extensions</code>，启用开发者模式，点击「加载已解压的扩展程序」，选择扩展目录。</li><li>保持 Chrome 打开，点击「检测连接」查看官方诊断结果。</li></ol>
              <div className="tools-actions"><a className="btn" href="https://github.com/jackwener/opencli/releases" target="_blank" rel="noreferrer">打开扩展下载页 <span aria-hidden="true">↗</span></a><button className="btn" disabled={busy || !state.version || !!draft} onClick={() => void action("opencli.doctor")}>检测连接</button></div>
              <p className="field-help tools-help">扩展需要在 Chrome 中手动安装。检测会运行 OpenCLI doctor，并按需启动浏览器桥接服务。</p>
              {state.diagnostic && <details className="tools-diagnostic" open><summary>官方诊断报告 · {new Date(state.diagnostic.checkedAt).toLocaleTimeString()}</summary><pre>{state.diagnostic.text}</pre></details>}
            </section>
          </article>
        </div>
      </main>
    </div>
  );
}
