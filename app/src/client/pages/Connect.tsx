import { useEffect, useRef, useState } from "react";
import "../styles/connect.css";

type Service = { state: "running" | "stopped" | "stopping" | "missing" | "unmanaged"; active: string[]; url?: string; log?: string; message?: string; background?: boolean };
type Action = "status" | "start" | "stop" | "open";
const labels = { running: "服务运行中", stopped: "服务已停止", stopping: "服务正在退出", missing: "需要安装服务", unmanaged: "端口已被占用" };
function invoke(action: Action): Promise<Service> {
  const bridge = (window as unknown as { __TAURI_INTERNALS__?: { invoke: (command: string, args: object) => Promise<Service> } }).__TAURI_INTERNALS__;
  if (!bridge) return Promise.reject(new Error("服务控制需要在 Axiom2 桌面客户端中使用。浏览器用户可以在终端运行 axiom2 start。"));
  return bridge.invoke("axiom_service", { action });
}

export default function Connect() {
  const [service, setService] = useState<Service | null>(null);
  const [busy, setBusy] = useState<Action | null>(null);
  const [error, setError] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [copied, setCopied] = useState(false);
  const pending = useRef(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const stopButton = useRef<HTMLButtonElement>(null);
  const command = /Win/i.test(navigator.platform)
    ? "irm https://raw.githubusercontent.com/cosyeezz/axiom2/master/install.ps1 | iex"
    : "curl -fsSL https://raw.githubusercontent.com/cosyeezz/axiom2/master/install.sh | sh";

  async function act(action: Action, quiet = false) {
    if (pending.current && quiet) return;
    if (!quiet) { setBusy(action); setError(""); }
    while (pending.current) await new Promise((resolve) => window.setTimeout(resolve, 80));
    pending.current = true;
    try { setService(await invoke(action)); if (!quiet) setError(""); }
    catch (err) { setError(err instanceof Error ? err.message : String(err)); }
    finally { pending.current = false; if (!quiet) setBusy(null); }
  }
  useEffect(() => {
    void act("status");
    const timer = window.setInterval(() => { void act("status", true); }, 3000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    if (confirm) dialog.current?.showModal();
    else if (dialog.current?.open) { dialog.current.close(); stopButton.current?.focus(); }
  }, [confirm]);
  const running = service?.state === "running";
  const missing = service?.state === "missing";
  return (
    <main className="connect-page">
      <header className="connect-header"><a href="#" aria-label="Axiom2 首页" className="connect-brand">A<span>2</span></a><span>AXIOM2 <i>/</i> DESKTOP</span><span className="connect-local">本机 · 私有工作台</span></header>
      <div className="connect-layout">
        <section className="connect-intro">
          <p className="connect-eyebrow">你的工作，从这里开始</p>
          <h1>就绪之后，<br /><span>专注创造。</span></h1>
          <p className="connect-lead">在这里管理本机服务。启动后打开工作台，继续你的项目、会话与任务。</p>
          <div className="connect-note"><span aria-hidden="true">↗</span><p>后台服务独立运行。<br /><small>关闭客户端，任务仍会继续。</small></p></div>
        </section>
        <section className="connect-panel" aria-label="本地服务控制">
          <div className="connect-panel-top"><span>本地服务</span><button className="connect-refresh" onClick={() => void act("status")} disabled={!!busy}>刷新状态 <span aria-hidden="true">↻</span></button></div>
          <div className="connect-status" role="status" aria-live="polite"><span className={`connect-dot ${running ? "is-running" : ""}`} /><h2>{busy === "start" ? "正在启动服务…" : busy === "stop" ? "正在关闭服务…" : service ? labels[service.state] : "正在检查服务…"}</h2></div>
          <p className="connect-status-detail">{busy === "start" ? "首次启动可能需要一些时间，请稍候。" : busy === "stop" ? "正在结束任务并保存状态，请稍候。" : running ? "连接已就绪，可以打开工作台。" : missing ? "安装一次，即可在客户端启动和关闭服务。" : service?.state === "stopping" ? "正在结束任务，请等待服务退出。" : service?.state === "unmanaged" ? "请处理端口占用后再启动。" : "服务尚未启动，点击下方按钮即可启动。"}</p>
          <dl className="connect-details"><div><dt>连接地址</dt><dd>{service?.url || "http://127.0.0.1:4317/"}</dd></div><div><dt>运行中的会话</dt><dd>{running ? `${service.active.length}${service.active.length >= 20 ? "+" : ""}` : "—"}</dd></div></dl>
          {service?.message && <p className="connect-message">{service.message}</p>}
          {error && <p className="connect-error" role="alert">{error}</p>}
          <div className="connect-actions">
            {running ? <><button className="connect-primary" disabled={!!busy} onClick={() => void act("open")}>打开工作台 <span aria-hidden="true">↗</span></button><button ref={stopButton} className="connect-secondary" disabled={!!busy} onClick={() => setConfirm(true)}>关闭后台服务</button></>
              : <button className="connect-primary" disabled={!!busy || !service || service.state !== "stopped"} onClick={() => void act("start")}>{busy === "start" ? "正在启动…" : "启动后台服务"}<span aria-hidden="true">→</span></button>}
          </div>
          <p className="connect-footnote">关闭服务会停止正在运行的任务。{running && service.background === false ? "当前服务由终端启动。" : "不会随系统登录自动启动。"}</p>
        </section>
      </div>
      <details className="connect-install" open={missing || undefined}>
        <summary>首次使用 / 更新服务 <span>一行命令安装</span></summary>
        <p>先安装 Node.js 24 或更新版本，再在终端运行以下命令。更新前先关闭服务；安装完成后点击“刷新状态”。</p>
        <div className="connect-command"><code>{command}</code><button onClick={() => { void navigator.clipboard.writeText(command).then(() => setCopied(true), () => setError("复制失败，请手动复制安装命令。")); }}>{copied ? "已复制" : "复制命令"}</button></div>
        {service?.log && <p className="connect-log">服务日志：<code>{service.log}</code></p>}
      </details>
      <footer className="connect-footer"><span>文件和任务留在你的电脑上</span><span>Axiom2 / 本地服务控制</span></footer>
      <dialog ref={dialog} className="connect-dialog" onCancel={() => setConfirm(false)} onClose={() => setConfirm(false)} aria-labelledby="stop-title">
        <h2 id="stop-title">关闭后台服务？</h2>
        <p>{service?.active.length ? `当前有 ${service.active.length}${service.active.length >= 20 ? "+" : ""} 个会话正在执行任务，关闭服务会中断这些任务。` : "关闭后工作台窗口会关闭，尚未结束的任务将被停止。"}项目和会话记录会保留。</p>
        {!!service?.active.length && <ul>{service.active.map((title, index) => <li key={index}>{title || "未命名会话"}</li>)}</ul>}
        <div className="connect-dialog-actions"><button className="connect-secondary" autoFocus onClick={() => setConfirm(false)}>继续运行</button><button className="connect-danger" onClick={() => { setConfirm(false); void act("stop"); }}>确认关闭服务</button></div>
      </dialog>
    </main>
  );
}
