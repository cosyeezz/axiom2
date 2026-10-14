import { useEffect, useRef, useState } from "react";

type UpdateAction = "status" | "check" | "service" | "client" | "recover" | "installer";
type Update = {
  clientVersion: string; serviceVersion: string | null; managed: boolean; clientSupported: boolean;
  release: { version: string; checkedAt: number; assets: Record<string, { url: string }> } | null;
  job: { kind: string; version?: string; running: boolean; phase: string; message: string } | null;
  recovery: boolean; log: string;
};
function newer(a: string | undefined, b: string | null | undefined) {
  if (!a || !b) return false;
  const x = a.split(".").map(Number), y = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i];
  return false;
}
function invoke(action: UpdateAction, version?: string): Promise<Update> {
  const bridge = (window as unknown as { __TAURI_INTERNALS__?: { invoke: (command: string, args: object) => Promise<Update> } }).__TAURI_INTERNALS__;
  if (!bridge) return Promise.reject(Error("请在 Axiom2 桌面客户端内检查更新。"));
  return bridge.invoke("axiom_update", { action, version: version || null });
}
export default function DesktopUpdates({ service, serviceBusy, onBusyChange, onServiceChange }: {
  service: { state: string; active: string[] } | null; serviceBusy: boolean;
  onBusyChange: (busy: boolean) => void; onServiceChange: () => void;
}) {
  const [update, setUpdate] = useState<Update | null>(null);
  const [busy, setBusy] = useState<UpdateAction | null>(null);
  const [error, setError] = useState("");
  const [confirm, setConfirm] = useState<"service" | "recover" | "installer" | null>(null);
  const pending = useRef(false);
  const previousRunning = useRef(false);
  const manualError = useRef(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLElement | null>(null);
  const latest = update?.release?.version;
  const running = !!update?.job?.running;
  const backendBusy = (running && update?.job?.kind !== "client") || busy === "service" || busy === "recover";
  const disabled = !!busy || running || serviceBusy;
  async function act(action: UpdateAction, quiet = false) {
    if (pending.current && quiet) return;
    if (!quiet) { setBusy(action); setError(""); manualError.current = false; }
    while (pending.current) await new Promise((resolve) => window.setTimeout(resolve, 80));
    pending.current = true;
    if (action === "service" || action === "recover") onBusyChange(true);
    try {
      const result = await invoke(action, action === "service" || action === "client" ? latest : undefined);
      if (action === "installer") return;
      setUpdate(result);
      if (previousRunning.current && !result.job?.running) onServiceChange();
      previousRunning.current = !!result.job?.running;
      if (!quiet || !manualError.current) setError("");
    } catch (cause) {
      if (!quiet) manualError.current = true;
      if (!quiet || !manualError.current) setError(cause instanceof Error ? cause.message : String(cause));
    }
    finally { pending.current = false; if (!quiet) setBusy(null); }
  }
  useEffect(() => {
    void act("status", true);
    const timer = window.setInterval(() => { void act("status", true); }, 2000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => { onBusyChange(backendBusy); }, [backendBusy, onBusyChange]);
  useEffect(() => {
    if (confirm) dialog.current?.showModal();
    else if (dialog.current?.open) { dialog.current.close(); trigger.current?.focus(); }
  }, [confirm]);
  const ask = (action: "service" | "recover" | "installer") => { trigger.current = document.activeElement as HTMLElement; setConfirm(action); };
  return (
    <section className="connect-updates" aria-label="版本与更新">
      <div className="connect-updates-heading"><div><p className="connect-eyebrow">保持就绪</p><h2>版本与更新</h2></div><button className="connect-secondary" disabled={disabled} onClick={() => void act("check")}>{busy === "check" ? "正在检查…" : "检查更新"}</button></div>
      <dl className="connect-versions"><div><dt>桌面客户端</dt><dd>{update?.clientVersion || "—"}</dd></div><div><dt>后台服务</dt><dd>{update?.serviceVersion || "—"}</dd></div><div><dt>最新版本</dt><dd>{latest || "尚未检查"}</dd></div></dl>
      <p className="connect-update-detail">后台更新会结束当前任务、保留项目与会话记录。安装包准备好后再切换版本，更新任务会在关闭客户端后继续。</p>
      {update && !update.managed && <p className="connect-message">当前服务不是标准安装，请使用原安装方式更新后台。</p>}
      {update?.release && !newer(latest, update.serviceVersion) && !newer(latest, update.clientVersion) && <p className="connect-update-current">已是最新版本。</p>}
      {update?.job && <p className={`connect-update-progress ${update.job.phase === "error" || update.job.phase === "interrupted" ? "has-error" : ""}`} role="status" aria-live="polite">{running && <span className="connect-update-pulse" aria-hidden="true" />}{update.job.message}</p>}
      {error && error !== update?.job?.message && <p className="connect-error" role="alert">{error}</p>}
      <div className="connect-actions">
        <button className="connect-secondary" disabled={disabled || !update?.managed || update.recovery || !newer(latest, update.serviceVersion) || !["running", "stopped"].includes(service?.state || "")} onClick={() => ask("service")}>更新后台服务{newer(latest, update?.serviceVersion) ? ` · ${latest}` : ""}</button>
        {update?.clientSupported && update.release?.assets["Axiom2.msi"] && <button className="connect-secondary" disabled={disabled || !newer(latest, update.clientVersion)} onClick={() => void act("client")}>下载客户端更新</button>}
        {update?.job?.kind === "client" && update.job.phase === "ready" && <button className="connect-secondary" disabled={disabled} onClick={() => ask("installer")}>运行安装器</button>}
        {update?.recovery && <button className="connect-secondary" disabled={disabled} onClick={() => ask("recover")}>恢复旧版本</button>}
      </div>
      {update?.log && <p className="connect-log">更新日志：<code>{update.log}</code></p>}
      <dialog ref={dialog} className="connect-dialog" onCancel={() => setConfirm(null)} onClose={() => setConfirm(null)} aria-labelledby="update-title">
        <h2 id="update-title">{confirm === "installer" ? "打开客户端安装向导？" : confirm === "recover" ? "恢复之前的服务版本？" : `更新后台至 ${latest}？`}</h2>
        <p>{confirm === "installer" ? "安装包已经校验。打开安装向导后，本客户端会关闭，后台服务继续运行。请按向导完成安装，再打开 Axiom2。" : "工作台窗口会关闭，正在运行的任务将结束。项目和会话数据会保留；程序切换失败会尝试恢复旧版本。请先保存需要保留的工作。"}</p>
        {confirm !== "installer" && !!service?.active.length && <ul>{service.active.map((title, index) => <li key={index}>{title || "未命名会话"}</li>)}</ul>}
        <div className="connect-dialog-actions"><button className="connect-secondary" autoFocus onClick={() => setConfirm(null)}>暂不更新</button><button className="connect-primary" onClick={() => { const action = confirm; setConfirm(null); if (action) void act(action); }}>{confirm === "installer" ? "打开安装向导" : confirm === "recover" ? "确认恢复" : "确认更新服务"}</button></div>
      </dialog>
    </section>
  );
}
