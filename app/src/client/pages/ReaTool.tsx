import { Icon } from "../Icon.js";
import { BackendMaintenance } from "../maintenance/BackendMaintenance.js";
import { useEffect, useRef, useState } from "react";
import { emptyMaintenanceState } from "../../shared/maintenance.js";
import { emptyReaState, reaVersion, type ReaState } from "../../shared/rea.js";
import { LocalPath } from "../LocalPath.js";
import { ReaEngines } from "./ReaEngines.js";
import { command, useConnectionState, useScope } from "../transport.js";

export function ReaTool({ active }: { active: boolean }) {
  const state = useScope("builtin-tools:rea", emptyReaState);
  const connection = useConnectionState();
  const maintenance = useScope("maintenance", emptyMaintenanceState);
  const [sending, setSending] = useState(false), [feedback, setFeedback] = useState<{ text: string; error?: boolean }>();
  const checkButton = useRef<HTMLButtonElement>(null);
  const focusAfterReconcile = useRef(false);
  const [uninstall, setUninstall] = useState<string>();
  const [choice, setChoice] = useState<{ revision: string; enabled: boolean }>();
  const busy = sending || !!state.job?.running || !!state.pendingOperation || !connection.connected;
  useEffect(() => {
    if (!busy && focusAfterReconcile.current) { focusAfterReconcile.current = false; checkButton.current?.focus(); }
  }, [busy]);
  const target = state.latest ?? reaVersion;
  const older = !!state.version && state.version !== target && state.version.split(".").map(Number).some((part, i, current) =>
    current.slice(0, i).every((n, j) => n === Number(target.split(".")[j])) && part > Number(target.split(".")[i]));
  useEffect(() => {
    if (active && connection.connected) void command("rea.refresh").catch((error: Error) => setFeedback({ text: error.message, error: true }));
  }, [active, connection.connected, connection.generation]);
  async function action(op: string, params: Record<string, unknown> = {}) {
    setSending(true); setFeedback(undefined);
    try {
      await command(op, params) as ReaState;
      if (op === "rea.reconcile") {
        setFeedback({ text: "已确认原操作停止；文件与配置已保留，请检查当前安装。" });
        focusAfterReconcile.current = true;
      }
      if (op === "rea.engineSave") setFeedback({ text: "组件路径已保存，请检测配套组件；已有会话需重新加载技能与 MCP。" });
      if (op === "rea.save") setFeedback({ text: "默认设置已保存；已有会话请在技能与 MCP 面板重新加载。" });
      if (["rea.installSkill", "rea.uninstallSkill", "rea.installMcp", "rea.uninstallMcp"].includes(op)) {
        const installed = op.startsWith("rea.install");
        setFeedback({ text: `${op.endsWith("Skill") ? "Skill" : "MCP"} 已${installed ? "安装" : "卸载"}；已有会话请在技能与 MCP 面板调整选择并重新加载。` });
      }
    } catch (error) { setChoice(undefined); setFeedback({ text: (error as Error).message, error: true }); }
    finally { setSending(false); }
  }
  const error = feedback?.error ? feedback.text : state.error || (!feedback ? state.job?.error : undefined);
  const reportedErrorJob = error && (error === state.job?.error || !!state.pendingOperation) ? state.job : undefined;
  const reportedErrorResource = reportedErrorJob ? (reportedErrorJob.engine ? `rea:${reportedErrorJob.engine}` : "rea") : error ? maintenance.tasks.findLast(task => (task.resource === "rea" || task.resource.startsWith("rea:")) && (task.error?.message === error || !!state.pendingOperation && ["unknown", "interrupted"].includes(task.status)))?.resource : undefined;
  return <article className="supplier-detail tools-detail" id="rea" aria-labelledby="rea-heading" style={active ? undefined : { display: "none" }}>
    <div className="detail-heading row-between"><div><h2 id="rea-heading">REA</h2><p className="meta">Reverse Engineer Anything · 分析 JavaScript、应用程序和二进制文件。</p></div><span className="tag">{state.version ? "已安装" : "待安装"}</span></div>
    <div className="tools-content">
      <div className="tools-feedback" aria-live="polite">
        {error ? <p className="tools-error" role="alert">{error}</p> : <p role="status">{feedback?.text || state.job?.message || "安装官方 REA 后，技能与 MCP 会一起加入能力列表。"}</p>}
        {!connection.connected && <p>连接已断开；重连后读取当前操作进度。</p>}
      </div>
      <BackendMaintenance resource="rea" label="REA" showError={reportedErrorResource !== "rea"} location="所连接后台 · 应用级 · Axiom 独立管理">
        <dl className="tools-facts">
          <div><dt>运行环境</dt><dd>{state.nodeVersion ? `Node.js ${state.nodeVersion}` : "等待检查"}</dd></div>
          <div><dt>当前版本</dt><dd>{state.version ? <code>v{state.version}</code> : "未安装"}</dd></div>
          <div><dt>{state.latest ? "最新版本" : "推荐版本"}</dt><dd><code>v{target}</code></dd></div>
        </dl>
        {!state.supported && state.nodeVersion && <p className="tools-error">{state.supportError || "需要 Node.js 22.19+（22.x）、24.11+（24.x）或 26+。"}</p>}
        {state.pendingOperation && !state.job?.running && <div className="tools-conflict" role="group" aria-label="核实 REA 中断任务"><p>上次维护尚未确认结束。核实只检查退出与提交记录，保留现有安装文件。</p><button className="btn" disabled={sending || !connection.connected} onClick={() => void action("rea.reconcile", { operationId: state.pendingOperation })}><Icon name={sending ? "loader-circle" : "refresh-cw"} />{sending ? "正在核实…" : "核实中断任务"}</button></div>}
        <div className="tools-actions">
          <button ref={checkButton} className="btn" disabled={busy} onClick={() => void action("rea.refresh")}>检查安装</button>
          <button className="btn" disabled={busy || !state.supported} onClick={() => void action("rea.check")}>检查更新</button>
          <button className="btn btn-primary" disabled={busy || !state.supported || older} onClick={() => void action("rea.install", { version: target })}>{state.job?.running && state.job.kind === "install" ? "正在安装…" : state.version === target ? "重新安装 REA" : state.version ? "更新 REA" : "安装 REA"}</button>
          {(state.version || state.removalPending) && <button className="btn" disabled={busy} onClick={() => setUninstall(state.revision)}><Icon name="trash-2" />{state.removalPending ? "清理残留程序" : "卸载 REA"}</button>}
          {state.job?.running && !["uninstall", "engine-uninstall"].includes(state.job.kind) && <button className="btn" disabled={sending || !connection.connected} onClick={() => void action("rea.cancel", { jobId: state.job!.id })}>取消操作</button>}
        </div>
        {uninstall !== undefined && <div className="tools-conflict" role="group" aria-label="确认卸载 REA">
          <p>移除 Axiom 托管的 REA 程序及其技能、MCP 安装引用。保留默认设置、分析引擎与组件路径；正在执行任务时须先结束任务。</p>
          <div className="tools-actions"><button className="btn" disabled={busy} onClick={() => { const revision = uninstall; setUninstall(undefined); void action("rea.uninstall", { revision, confirm: true }); }}><Icon name="trash-2" />确认卸载</button><button className="btn" onClick={() => setUninstall(undefined)}>暂不卸载</button></div>
        </div>}
        <p className="field-help tools-help">安装到 Axiom 独立目录。新版本通过连接检查后才生效，失败或取消保留当前版本。下载原生依赖可能需要几分钟；可离开页面，稍后回来查看进度。</p>
        {state.packageRoot && <p className="tools-path">安装位置 <LocalPath path={state.packageRoot} /></p>}
      </BackendMaintenance>
      <section className="section tools-section" aria-labelledby="rea-skill-heading">
        <div className="section-heading row-between"><div><h3 id="rea-skill-heading">Skill</h3><p>reverse-engineer-anything · 逆向分析指南</p></div><span className="tag">{state.skillError ? "文件不完整" : state.skillInstalled ? "已安装" : "未安装"}</span></div>
        {state.skillError && <p className="tools-error" role="alert">{state.skillError}</p>}
        <div className="tools-actions">
          <button className="btn" disabled={busy || !state.version || state.skillInstalled && !state.skillError} onClick={() => void action("rea.installSkill", { revision: state.revision })}>安装 Skill</button>
          <button className="btn" disabled={busy || !state.skillInstalled} onClick={() => void action("rea.uninstallSkill", { revision: state.revision })}>卸载 Skill</button>
        </div>
        <p className="field-help tools-help">从当前 REA 安装包接入技能及引用文档。卸载后移除内置技能，MCP 可继续使用；包内源文件保留，重新安装无需下载。已有的同名普通技能可作为回退来源继续使用。</p>
      </section>
      <section className="section tools-section" aria-labelledby="rea-mcp-heading">
        <div className="section-heading row-between"><div><h3 id="rea-mcp-heading">MCP</h3><p>rea · 逆向分析工具服务</p></div><span className="tag">{state.mcpError ? "文件不完整" : state.mcpInstalled ? "已安装" : "未安装"}</span></div>
        {state.mcpError && <p className="tools-error" role="alert">{state.mcpError}</p>}
        <div className="tools-actions">
          <button className="btn" disabled={busy || !state.version || state.mcpInstalled && !state.mcpError} onClick={() => void action("rea.installMcp", { revision: state.revision })}>安装 MCP</button>
          <button className="btn" disabled={busy || !state.mcpInstalled} onClick={() => void action("rea.uninstallMcp", { revision: state.revision })}>卸载 MCP</button>
        </div>
        <p className="field-help tools-help">安装当前 REA 的内置连接。卸载后保留 Skill 和 REA 程序，方便再次安装。内置连接可用时优先；卸载后已有的同名普通 MCP 可继续使用，需在「技能与 MCP」中另行管理。</p>
      </section>
      <section className="section tools-section" aria-labelledby="rea-config-heading">
        <div className="section-heading"><h3 id="rea-config-heading">默认使用</h3></div>
        <label className="tools-toggle"><input type="checkbox" checked={choice?.revision === state.revision ? choice.enabled : state.enabled} disabled={busy || !state.version} onChange={e => { setChoice({ revision: state.revision, enabled: e.target.checked }); void action("rea.save", { enabled: e.target.checked, revision: state.revision }); }} /><span><strong>默认启用 REA</strong><small>新会话默认选用已安装的 Skill 与 MCP；会话及全局能力选择优先。</small></span></label>
        <p className="field-help tools-help">更新或重装 REA 会保留两个组件的安装选择。已有会话请在「技能与 MCP」面板调整选择后重新加载；无同名回退资源时，请取消失效的选择。卸载不会中断正在执行的任务。</p>
      </section>
      <ReaEngines state={state} busy={busy} action={action} reportedErrorResource={reportedErrorResource} />
      <section className="section tools-section" aria-labelledby="rea-doctor-heading">
        <div className="section-heading"><h3 id="rea-doctor-heading">连接检查</h3><p>检查版本、工具列表，并实际调用会话检查工具。</p></div>
        <button className="btn" disabled={busy || !!state.supportError || !state.version} onClick={() => void action("rea.doctor")}>检测 REA 连接</button>
        <p className="field-help tools-help">JavaScript 静态分析可直接使用。原生反编译需要另行配置 Hopper、Ghidra、IDA 等引擎；SQLite 分析需要 Node.js 24.15+（24.x）或 26+。</p>
        {state.diagnostic && <details className="tools-diagnostic" open><summary>连接报告 · {new Date(state.diagnostic.at).toLocaleTimeString()}</summary><pre>{state.diagnostic.text}</pre></details>}
      </section>
    </div>
  </article>;
}
