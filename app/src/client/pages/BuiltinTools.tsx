import { ReaTool } from "./ReaTool.js";
import { emptyReaState } from "../../shared/rea.js";
import { ModelProxyTool } from "./ModelProxyTool.js";
import { emptyModelProxyState } from "../../shared/model-proxy.js";
import { RtkTool } from "./RtkTool.js";
import { emptyRtkState } from "../../shared/rtk.js";
import { useEffect, useState } from "react";
import { LocalPath } from "../LocalPath.js";
import { SettingsSidebar } from "../components.js";
import { SettingsHeader } from "../settings/SettingsHeader.js";
import { BrowserWindowSelect } from "./BrowserWindowSelect.js";
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
const selectedTool = () => location.hash === "#rea" ? "rea" : location.hash === "#rtk" ? "rtk" : location.hash === "#model-proxy" ? "model-proxy" : "opencli";
export default function BuiltinTools() {
  const [selected, setSelected] = useState(selectedTool);
  const proxy = useScope("builtin-tools:model-proxy", emptyModelProxyState);
  const rea = useScope("builtin-tools:rea", emptyReaState);
  const rtk = useScope("builtin-tools:rtk", emptyRtkState);
  useEffect(() => { const sync = () => setSelected(selectedTool()); window.addEventListener("hashchange", sync); return () => window.removeEventListener("hashchange", sync); }, []);
  const state = useScope("builtin-tools:opencli", empty);
  const connection = useConnectionState();
  const connectionText = useConnection();
  const [draft, setDraft] = useState<{ revision: string; settings: OpenCliSettings }>();
  const [sending, setSending] = useState(false);
  const [feedback, setFeedback] = useState<{ text: string; error?: boolean; revision?: string }>();
  const settings = draft?.settings ?? state.settings;
  const busy = sending || !!state.job?.running || !connection.connected;
  const queued = !!state.job?.running && !!state.job.queued;
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
      if (op === "opencli.openExtension") setFeedback({ text: params.target === "download" ? "已请求系统浏览器打开官方压缩包下载页。" : "已请求系统浏览器打开 Chrome 应用商店。" });
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
        <SettingsHeader page="tools" />
        <div className="configuration-layout">
          <aside className="supplier-panel" aria-label="内置工具列表">
            <div className="supplier-toolbar"><h2>全部工具 <span className="meta num">4</span></h2></div>
            <nav className="supplier-list">
              <a className="supplier-option" href="#opencli" aria-current={selected === "opencli" ? "true" : undefined}><span><strong>OpenCLI <span className="tag">浏览器</span></strong><small>{installStatus}</small></span></a>
              <a className="supplier-option" href="#rea" aria-current={selected === "rea" ? "true" : undefined}><span><strong>REA <span className="tag">逆向分析</span></strong><small>{rea.version ? `v${rea.version}${rea.error ? " · 需修复" : ""}` : "未安装"}</small></span></a>
              <a className="supplier-option" href="#rtk" aria-current={selected === "rtk" ? "true" : undefined}><span><strong>RTK <span className="tag">输出过滤</span></strong><small>{rtk.version ? `v${rtk.version} · ${rtk.settings.enabled ? "已启用" : "未启用"}` : "未安装"}</small></span></a>
              <a className="supplier-option" href="#model-proxy" aria-current={selected === "model-proxy" ? "true" : undefined}><span><strong>模型代理 <span className="tag">网络</span></strong><small>{proxy.profiles.filter(p => p.status === "running").length} 条线路运行中</small></span></a>
            </nav>
          </aside>
          <article className="supplier-detail tools-detail" id="opencli" aria-labelledby="opencli-heading" style={selected === "opencli" ? undefined : { display: "none" }}>
            <div className="detail-heading row-between"><div><h2 id="opencli-heading">OpenCLI</h2><p className="meta">连接 Chrome，让 Agent 操作网页和已登录的网站。</p></div><span className="tag">{state.configured ? "已配置" : "待接入"}</span></div>
            <div className="tools-content">
            <div className="tools-feedback" aria-live="polite">
              {error ? <p className="tools-error" role="alert">{error}</p> : <p role="status">{notice?.text || state.job?.message || (connection.connected ? connectionText : `${connectionText}；重连后读取当前操作进度。`)}</p>}
              {!connection.connected && (error || notice?.text || state.job?.message) && <p>{connectionText}；重连后读取当前操作进度。</p>}
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
                <button className="btn btn-primary" disabled={busy || !state.latest || !!draft || (!!state.version && state.version !== state.latest && !update)} onClick={() => void action("opencli.install", { version: state.latest })}>{state.job?.running && state.job.kind === "install" ? queued ? "等待空闲…" : "正在安装…" : state.version ? update ? "更新 OpenCLI" : "重新安装" : "安装 OpenCLI"}</button>
              </div>
              {queued && <button className="btn" disabled={sending || !connection.connected} onClick={() => void action("opencli.cancel", { jobId: state.job!.id })}>取消排队</button>}
              <p className="field-help tools-help">先检查更新，再安装已确认的版本。任务运行时点击安装会加入队列，空闲后自动执行，可离开此页面或取消排队。后台服务退出会取消排队。使用 npm 全局安装；更新会影响本机其他使用同一 OpenCLI 的程序。安装失败时可重新检查并重试。</p>
              {state.packageRoot && <p className="tools-path">安装位置 <LocalPath path={state.packageRoot} /></p>}
            </section>
            <section className="section tools-section" aria-labelledby="config-heading">
              <div className="section-heading"><h3 id="config-heading">接入设置</h3><p>仅对 Axiom 主 Agent 生效</p></div>
              <fieldset className="tools-fields" disabled={busy || !state.version}>
                <label className="tools-toggle"><input type="checkbox" checked={settings.enabled} onChange={(e) => change({ enabled: e.target.checked })} /><span><strong>默认加载常用技能</strong><small><code>opencli-usage</code> 与 <code>opencli-browser</code>；简介常驻，完整指南按需读取。</small></span></label>
                <div className="grid-2">
                  <div className="field"><label htmlFor="opencli-profile">Chrome 配置档案</label><input className="input" id="opencli-profile" value={settings.profile} maxLength={128} placeholder="留空使用 OpenCLI 默认选择" onChange={(e) => change({ profile: e.target.value })} /><p className="field-help">多个 Chrome 账号同时连接时，填写诊断报告中的 Profile ID 或已设置的别名。</p></div>
                  <div className="field"><label htmlFor="opencli-window">浏览器窗口</label><BrowserWindowSelect value={settings.window} disabled={busy || !state.version} onChange={(window) => change({ window })} /><p className="field-help" id="opencli-window-help">后台模式仍需要 Chrome 和浏览器扩展保持运行。</p></div>
                </div>
              </fieldset>
              {conflict && <div className="tools-conflict" role="status"><p>配置已在其他窗口修改。可放弃修改并载入最新配置，或用当前输入覆盖最新设置。</p><button className="btn" disabled={busy || !state.version} onClick={() => void action("opencli.save", { ...settings, revision: state.revision })}>用当前输入保存</button></div>}
              <div className="configuration-actions" aria-label="接入设置操作">
                <button className="btn btn-primary" disabled={busy || conflict || !state.version || (!draft && state.configured)} onClick={() => void action("opencli.save", { ...settings, revision: draft?.revision ?? state.revision })}>保存接入设置</button>
                <button className="btn btn-ghost" disabled={busy || !draft} onClick={() => { setDraft(undefined); setFeedback(undefined); }}>放弃修改</button>
                <span className="save-state" data-dirty={!!draft}>{draft ? "有未保存的修改" : state.configured ? "已保存 · 后续执行自动加载" : "已有安装可直接保存接入设置"}</span>
              </div>
            </section>
            <section className="section tools-section" aria-labelledby="browser-heading">
              <div className="section-heading"><h3 id="browser-heading">浏览器扩展与连接</h3></div>
              <ol className="tools-steps"><li><strong>Chrome 应用商店安装（推荐）</strong>：打开商店页面，在 Chrome 中点击「添加至 Chrome」。</li><li><strong>手动下载压缩包</strong>：从官方发布页下载 <code>opencli-extension-v&#123;version&#125;.zip</code> 并解压。在 <code>chrome://extensions</code> 中启用开发者模式，点击「加载已解压的扩展程序」，选择解压后的扩展目录。</li></ol>
              <div className="tools-actions"><button className="btn btn-primary" disabled={sending || !connection.connected} onClick={() => void action("opencli.openExtension", { target: "store" })}>Chrome 应用商店安装 <span aria-hidden="true">↗</span></button><button className="btn" disabled={sending || !connection.connected} onClick={() => void action("opencli.openExtension", { target: "download" })}>手动下载压缩包 <span aria-hidden="true">↗</span></button><button className="btn" disabled={busy || !state.version || !!draft} onClick={() => void action("opencli.doctor")}>检测连接</button></div>
              <p className="field-help tools-help">任选一种方式安装扩展，然后保持 Chrome 和扩展启用，点击「检测连接」查看诊断结果。</p>
              {state.diagnostic && <details className="tools-diagnostic" open><summary>官方诊断报告 · {new Date(state.diagnostic.checkedAt).toLocaleTimeString()}</summary><pre>{state.diagnostic.text}</pre></details>}
            </section>
            </div>
          </article>
          <ReaTool active={selected === "rea"} />
          <RtkTool active={selected === "rtk"} />
          <ModelProxyTool active={selected === "model-proxy"} />
        </div>
      </main>
    </div>
  );
}
