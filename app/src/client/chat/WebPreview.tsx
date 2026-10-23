import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { command } from "../transport.js";
import type { OpenFileReference } from "./FileLink.js";
import type { WebPreviewDescription, WebPreviewState } from "../../shared/web-preview.js";
const attribute = (text: string) => text.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

/** URL documents never share the workbench origin; the wrapper confines navigation. */
export function WebPreview({ reference, children }: { reference: OpenFileReference; children: ReactNode }) {
  const [description, setDescription] = useState<WebPreviewDescription | null>(null), [runtime, setRuntime] = useState<WebPreviewState | null>(null);
  const [expanded, setExpanded] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [mode, setMode] = useState<"page" | "project">("page"), [script, setScript] = useState(""), [network, setNetwork] = useState(false), [reload, setReload] = useState(0);
  const active = useRef<WebPreviewState | null>(null), alive = useRef(true), pending = useRef<AbortController | null>(null);
  const params = { messageId: reference.messageId, href: reference.href };
  const stop = async () => {
    const current = active.current; active.current = null; setRuntime(null);
    pending.current?.abort(); pending.current = null;
    if (current) try { await command("preview.stop", { id: current.id }, reference.owner.scope); } catch (e) { if (alive.current) setError((e as Error).message); }
  };
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; pending.current?.abort(); const current = active.current; active.current = null; if (current) void command("preview.stop", { id: current.id }, reference.owner.scope).catch(() => {}); };
  }, [reference]);
  useEffect(() => {
    if (!runtime) return;
    let reading = false;
    const timer = setInterval(() => {
      if (reading) return; reading = true;
      void command<WebPreviewState>("preview.status", { id: runtime.id }, reference.owner.scope).then(value => {
        if (alive.current && active.current?.id === value.id) { active.current = value; setRuntime(value); }
      }).catch(e => { if (alive.current && active.current?.id === runtime.id) { setError(e.message); void stop(); } }).finally(() => { reading = false; });
    }, 10000);
    return () => clearInterval(timer);
  }, [runtime?.id, reference]);
  const describe = async () => {
    setExpanded(true); setBusy(true); setError("");
    const controller = new AbortController(); pending.current = controller;
    try {
      const value = await command<WebPreviewDescription>("preview.describe", params, reference.owner.scope, crypto.randomUUID(), controller.signal);
      if (alive.current) { setDescription(value); setMode(value.entry ? "page" : "project"); setScript(value.scripts.find(s => s.name === "dev")?.name ?? value.scripts[0]?.name ?? ""); }
    } catch (e) { if (alive.current && !controller.signal.aborted) setError((e as Error).message); }
    finally { if (alive.current) setBusy(false); if (pending.current === controller) pending.current = null; }
  };
  const start = async () => {
    if (!description) return;
    const selected = description.scripts.find(s => s.name === script);
    const warning = mode === "project" ? `执行项目脚本：${script}\n${selected?.command ?? ""}\n\n这会在本机启动真实进程，不是操作系统沙箱；脚本可读写磁盘、启动其他程序或联网，不受下面的浏览器联网开关限制。不会自动安装依赖。` : "网页脚本将执行，并可读取以下目录内的非隐藏资源。浏览器策略不能阻止 WebRTC 等全部联网能力。";
    if (!window.confirm(`${warning}\n\n授权目录：${description.root}\n普通浏览器联网：${network ? "允许（含本机／内网）" : "默认限制"}\n\n仅运行可信文件。确认启动？`)) return;
    setBusy(true); setError(""); const controller = new AbortController(); pending.current = controller;
    try {
      const value = await command<WebPreviewState>("preview.start", { ...params, confirm: true, mode, script, network, revision: description.revision }, reference.owner.scope, crypto.randomUUID(), controller.signal);
      if (!alive.current || controller.signal.aborted) { void command("preview.stop", { id: value.id }, reference.owner.scope).catch(() => {}); return; }
      active.current = value; setRuntime(value);
    } catch (e) { if (alive.current && !controller.signal.aborted) setError((e as Error).message); }
    finally { if (alive.current) setBusy(false); if (pending.current === controller) pending.current = null; }
  };
  const url = runtime?.urls.find(value => new URL(value).hostname === location.hostname) ?? (["localhost", "127.0.0.1"].includes(location.hostname) ? runtime?.urls[0] : undefined);
  const document = useMemo(() => {
    if (!url) return "";
    const parsed = new URL(url), prefix = parsed.origin + "/" + parsed.pathname.split("/")[1] + "/";
    return `<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; frame-src ${attribute(prefix)}"><meta name="referrer" content="no-referrer"><style>html,body{margin:0;height:100%;overflow:hidden}iframe{width:100%;height:100%;border:0;display:block}</style><iframe title="独立网页文档" sandbox="allow-scripts" referrerpolicy="no-referrer" src="${attribute(url)}"></iframe>`;
  }, [url]);
  return <div className="file-web-preview">
    <div className="file-html-safety"><span>独立运行支持模块与动态资源；需单独授权，不改变默认静态预览。</span><button className="file-edit-action" disabled={busy} onClick={() => { if (expanded) { void stop(); setExpanded(false); } else void describe(); }}>{expanded ? "收起运行设置" : "网页／项目运行"}</button></div>
    {expanded && <section className="file-web-settings" aria-label="网页运行设置">
      {description && <><p>授权目录：<code>{description.root}</code></p><div className="file-web-actions">
        <label>模式 <select aria-label="网页运行模式" value={mode} disabled={busy || !!runtime} onChange={e => setMode(e.target.value as "page" | "project")}><option value="page" disabled={!description.entry}>网页（模块／动态资源）</option><option value="project" disabled={!description.scripts.length}>项目脚本</option></select></label>
        {mode === "project" && <label>脚本 <select aria-label="项目启动脚本" value={script} disabled={busy || !!runtime} onChange={e => setScript(e.target.value)}>{description.scripts.map(s => <option key={s.name} value={s.name}>{s.name}</option>)}</select></label>}
        <label><input type="checkbox" checked={network} disabled={busy || !!runtime} onChange={e => { if (!e.target.checked || window.confirm("允许普通浏览器请求访问互联网、本机及内网？页面可能向这些地址发送数据，跨域仍受 CORS 限制。")) setNetwork(e.target.checked); }} />允许普通联网</label>
        {runtime ? <><button className="btn" onClick={() => void stop()}>停止运行</button><button className="btn" onClick={() => setReload(n => n + 1)}>刷新网页</button></> : <><button className="btn" disabled={busy || mode === "page" && !description.entry || mode === "project" && !script} onClick={() => void start()}>{busy ? "正在处理…" : "确认并启动"}</button><button className="btn" disabled={busy} onClick={() => void describe()}>重新读取配置</button></>}
      </div>{mode === "project" && <p><code>{description.scripts.find(s => s.name === script)?.command}</code><br />真实本机进程，无磁盘或网络沙箱；不安装依赖。通用脚本须监听 PORT/HOST，Vite/Next dev 自动传端口。暂不支持 WebSocket 热更新。</p>}
      <p>仅限可信文件：脚本可能通过 WebRTC 等能力联网。关闭预览会停止运行；断线约 2 分钟回收，单次最多 30 分钟。浏览器存储、Service Worker 等同源能力受隔离限制。</p></>}
      {!description && !busy && <button className="btn" onClick={() => void describe()}>重新读取配置</button>}
      {error && <p role="alert">{error}</p>}{runtime?.log && <details><summary>运行日志{runtime.status === "exited" ? "（进程已退出）" : ""}</summary><pre>{runtime.log}</pre></details>}
    </section>}
    {runtime ? !url || location.protocol === "https:" ? <div className="file-empty" role="alert"><p>当前访问地址无法嵌入此 HTTP 预览。请使用本机或已启用的 Tailscale HTTP 工作台地址；HTTPS 页面会拦截混合内容。</p><button className="btn" onClick={() => void stop()}>停止运行</button></div> : <iframe key={`${runtime.id}:${reload}`} className="file-html-frame" title="独立网页运行预览" sandbox="allow-scripts" referrerPolicy="no-referrer" srcDoc={document} /> : children}
  </div>;
}
