import { operationFeedback } from "../operation-feedback.js";
import { Icon } from "../Icon.js";
import { BackendMaintenance } from "../maintenance/BackendMaintenance.js";
import { BuiltinRecovery } from "./BuiltinRecovery.js";
import { useEffect, useRef, useState } from "react";
import { emptyMaintenanceState } from "../../shared/maintenance.js";
import { emptyReaState, reaVersion, type ReaState } from "../../shared/rea.js";
import { LocalPath } from "../LocalPath.js";
import { ReaEngines, type ReaFeedback } from "./ReaEngines.js";
import { command, useConnectionState, useScope } from "../transport.js";

export function ReaTool({ active }: { active: boolean }) {
  const state = useScope("builtin-tools:rea", emptyReaState);
  const connection = useConnectionState();
  const maintenance = useScope("maintenance", emptyMaintenanceState);
  const [requests, setRequests] = useState<{ id: number; resource: string; op: string }[]>([]);
  const requestIds = useRef(0), latestRequest = useRef(new Map<string, number>());
  const [feedbacks, setFeedbacks] = useState<Record<string, ReaFeedback>>({});
  const jobs = state.jobs ?? (state.job ? [state.job] : []);
  const coreJob = jobs.find(job => !job.engine);
  const sending = requests.some(item => item.resource === "rea");
  const feedbackByResource = Object.fromEntries(Object.entries(feedbacks).filter(([resource, feedback]) => feedback.jobId === jobs.find(job => (job.engine ? `rea:${job.engine}` : "rea") === resource)?.id));
  const feedback = feedbackByResource.rea;
  const checkButton = useRef<HTMLButtonElement>(null);
  const focusAfterReconcile = useRef(false);
  const [uninstall, setUninstall] = useState<{ revision: string; cleanupRevision?: string }>();
  const [choice, setChoice] = useState<{ revision: string; enabled: boolean }>();
  const blocked = sending || !!coreJob?.running || !connection.connected;
  const busy = blocked || requests.length > 0 || jobs.some(job => job.running);
  useEffect(() => {
    if (!busy && focusAfterReconcile.current) { focusAfterReconcile.current = false; checkButton.current?.focus(); }
  }, [busy]);
  const target = state.latest ?? reaVersion;
  const older = !!state.version && state.version !== target && state.version.split(".").map(Number).some((part, i, current) =>
    current.slice(0, i).every((n, j) => n === Number(target.split(".")[j])) && part > Number(target.split(".")[i]));
  useEffect(() => {
    if (active && connection.connected) void action("rea.refresh");
  }, [active, connection.connected, connection.generation]);
  async function action(op: string, params: Record<string, unknown> = {}) {
    const resource = typeof params.engine === "string" ? `rea:${params.engine}` : "rea";
    const id = ++requestIds.current;
    latestRequest.current.set(resource, id);
    setRequests(previous => [...previous, { id, resource, op }]);
    setFeedbacks(previous => { const next = { ...previous }; delete next[resource]; return next; });
    let jobId = jobs.find(job => (job.engine ? `rea:${job.engine}` : "rea") === resource)?.id;
    const report = (value: Omit<ReaFeedback, "jobId">) => {
      if (latestRequest.current.get(resource) === id) setFeedbacks(previous => ({ ...previous, [resource]: { ...value, jobId } }));
    };
    try {
      const result = await command(op, params) as ReaState;
      jobId = (result.jobs ?? (result.job ? [result.job] : [])).find(job => (job.engine ? `rea:${job.engine}` : "rea") === resource)?.id;
      if (op === "rea.reconcile") {
        report({ text: "已确认原操作停止；文件与配置已保留，请检查当前安装。" });
        if (resource === "rea") focusAfterReconcile.current = true;
      }
      if (op === "rea.engineSave") report({ text: "组件路径已保存，请检测配套组件；已有会话需重新加载技能与 MCP。" });
      if (op === "rea.save") report({ text: "默认设置已保存；已有会话请在技能与 MCP 面板重新加载。" });
      if (["rea.installSkill", "rea.uninstallSkill", "rea.installMcp", "rea.uninstallMcp"].includes(op)) {
        const installed = op.startsWith("rea.install");
        report({ text: `${op.endsWith("Skill") ? "Skill" : "MCP"} 已${installed ? "安装" : "卸载"}；已有会话请在技能与 MCP 面板调整选择并重新加载。` });
      }
    } catch (error) { if (op === "rea.save") setChoice(undefined); report({ text: (error as Error).message, error: true }); }
    finally { setRequests(previous => previous.filter(item => item.id !== id)); }
  }
  const error = feedback?.error ? feedback.text : state.error || (!feedback ? coreJob?.error : undefined);
  const reportedErrorResources = jobs.filter(job => job.error && !feedbackByResource[job.engine ? `rea:${job.engine}` : "rea"] && maintenance.tasks.findLast(task => task.resource === (job.engine ? `rea:${job.engine}` : "rea"))?.id === job.id).map(job => job.engine ? `rea:${job.engine}` : "rea");
  return <article className="supplier-detail tools-detail" id="rea" aria-labelledby="rea-heading" style={active ? undefined : { display: "none" }}>
    <div className="detail-heading row-between"><div><h2 id="rea-heading">REA</h2><p className="meta">Reverse Engineer Anything · 分析 JavaScript、应用程序和二进制文件。</p></div><span className="tag">{state.version ? "已安装" : "待安装"}</span></div>
    <div className="tools-content">
      <div className="tools-feedback" aria-live="polite">
        {requests.length > 0 ? <p role="status">{operationFeedback(requests.at(-1)!.op)}</p> : error ? <p className="tools-error" role="alert">{error}</p> : <p role="status">{feedback?.text || coreJob?.message || "安装官方 REA 后，技能与 MCP 会一起加入能力列表。"}</p>}
        {!connection.connected && <p>连接已断开；重连后读取当前操作进度。</p>}
      </div>
      <BackendMaintenance resource="rea" label="REA" showError={!reportedErrorResources.includes("rea")} location="所连接后台 · 应用级 · Axiom 独立管理">
        <dl className="tools-facts">
          <div><dt>运行环境</dt><dd>{state.nodeVersion ? `Node.js ${state.nodeVersion}` : "等待检查"}{state.npmVersion ? ` · npm ${state.npmVersion}` : ""}{state.runtimeManaged ? " · 组件专用" : state.version ? " · 旧版共享环境" : " · 安装时自动准备专用环境"}</dd></div>
          <div><dt>当前版本</dt><dd>{state.version ? <code>v{state.version}</code> : "未安装"}</dd></div>
          <div><dt>{state.latest ? "最新版本" : "推荐版本"}</dt><dd><code>v{target}</code></dd></div>
        </dl>
        {state.version && !state.runtimeManaged && <p className="field-help">现有安装保持不变。重新安装或更新后使用与目标 REA 版本兼容的独立 Node/npm；不需要升级后台或系统 Node。</p>}
        {!state.supported && state.nodeVersion && <p className="tools-error">{state.supportError || "当前后台平台尚不支持内置工具进程。"}</p>}
        {state.pendingOperation && !coreJob?.running && <BuiltinRecovery label="REA" operationId={state.pendingOperation} disabled={busy} reconcile={force => void action("rea.reconcile", { operationId: state.pendingOperation, force })} />}
        <div className="tools-actions">
          <button ref={checkButton} className="btn" disabled={busy} onClick={() => void action("rea.refresh")}>检查安装</button>
          <button className="btn" disabled={busy || !state.supported} onClick={() => void action("rea.check")}>检查更新</button>
          <button className="btn btn-primary" disabled={busy || !state.supported || older} onClick={() => void action("rea.install", { version: target })}>{coreJob?.running && coreJob.kind === "install" ? "正在安装…" : state.version === target ? "重新安装 REA" : state.version ? "更新 REA" : "安装 REA"}</button>
          {(state.version || state.removalPending) && <button className="btn" disabled={busy} onClick={() => setUninstall({ revision: state.revision, cleanupRevision: state.cleanup?.revision })}><Icon name="trash-2" />{state.removalPending ? "清理残留程序" : "卸载 REA"}</button>}
          {coreJob?.running && !["uninstall", "engine-uninstall"].includes(coreJob.kind) && <button className="btn" disabled={sending || !connection.connected} onClick={() => void action("rea.cancel", { jobId: coreJob.id })}>取消操作</button>}
        </div>
        {uninstall !== undefined && <div className="tools-conflict inline-confirmation" role="group" aria-label="确认卸载 REA">
          <p>移除 Axiom 托管的 REA 程序及其技能、MCP 安装引用。保留默认设置、分析引擎与组件路径。等待已准入任务完成后自动卸载；等待期间可在任务面板取消。</p>
          <div className="tools-actions"><button className="btn" onClick={() => setUninstall(undefined)}>暂不卸载</button><button className="btn confirm-danger" disabled={busy} onClick={() => { const confirmation = uninstall; setUninstall(undefined); void action("rea.uninstall", { ...confirmation, confirm: true }); }}><Icon name="trash-2" />确认卸载</button></div>
        </div>}
        <p className="field-help tools-help">安装到 Axiom 独立目录。新版本通过连接检查后才生效，失败或取消保留当前版本。下载原生依赖可能需要几分钟；可离开页面，稍后回来查看进度。</p>
        {!!state.cleanupUnverified?.length && <p className="field-help">另有 {state.cleanupUnverified.length} 个旧程序目录缺少归属证明，将保留，不阻塞当前程序卸载。</p>}
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
      <section className="section tools-section" aria-labelledby="rea-auto-heading">
        <div className="section-heading row-between"><div><h3 id="rea-auto-heading">环境与资源</h3><p>自动发现已安装依赖，按可用资源分配分析预算。</p></div><span className="tag">自动</span></div>
        <p className="field-help">无需手动登记环境变量。仅注入 REA 专用进程，不修改系统环境；不会自动安装软件、提供许可证或执行目标程序。</p>
        {state.autoEnvironment && state.autoEnvironment.budget.heapMaximumMiB < 128 && <p className="tools-error" role="alert">当前可用内存不足以安全启动 REA。请等待其他任务完成后重新加载能力。</p>}
        {state.autoEnvironment && <details className="tools-diagnostic"><summary>资源详情</summary>
          <dl className="tools-facts">
            <div><dt>当前参考预算</dt><dd>堆 {state.autoEnvironment.budget.heapMiB} MiB · 上限 {state.autoEnvironment.budget.heapMaximumMiB} MiB · JADX 最多 {state.autoEnvironment.budget.cpus} 个处理器</dd></div>
            <div><dt>分析时限</dt><dd>按目标规模分配，单步最多 {state.autoEnvironment.budget.operationMaximumMs / 60_000} 分钟；排队、调整与重试合计最多 {state.autoEnvironment.budget.totalDeadlineMs / 60_000} 分钟</dd></div>
            <div><dt>并发与重试</dt><dd>同一后台跨会话串行；仅已审计版本的正则查询可安全升档，最多重试一次</dd></div>
          </dl>
          <p className="field-help">以上为当前机器的通用参考值，实际调用时重新计算，不代表已启动 JADX 的 JVM 配置。工具调用记录显示生效预算及调整原因；预算不是整个引擎的操作系统级内存硬限制。</p>
          {state.autoEnvironment.dependencies.length ? <ul>{state.autoEnvironment.dependencies.map(item => <li key={item.variable}><code>{item.variable}</code> · {item.source === "environment" ? "已有环境配置" : "自动发现"} · <LocalPath path={item.path} /></li>)}</ul> : <p className="field-help">未发现额外可选工具；托管引擎见下方配套组件。路径发现不代表版本、许可或实际分析已验证。</p>}
        </details>}
        <p className="field-help tools-help">新策略随会话启动或能力重载生效，不打断已有分析。超时、取消或清理未完成时不会盲目重复任务。</p>
      </section>
      <ReaEngines state={state} busy={busy} blocked={blocked} sending={requests.map(item => item.resource)} feedback={feedbackByResource} action={action} reportedErrorResources={reportedErrorResources} />
      <section className="section tools-section" aria-labelledby="rea-doctor-heading">
        <div className="section-heading"><h3 id="rea-doctor-heading">连接检查</h3><p>检查版本、工具列表，并实际调用会话检查工具。</p></div>
        <button className="btn" disabled={busy || !!state.supportError || !state.version} onClick={() => void action("rea.doctor")}>检测 REA 连接</button>
        <p className="field-help tools-help">JavaScript 静态分析可直接使用。原生反编译需要另行配置 Hopper、Ghidra、IDA 等引擎；SQLite 分析需要 Node.js 24.15+（24.x）或 26+。</p>
        {state.diagnostic && <details className="tools-diagnostic" open><summary>连接报告 · {new Date(state.diagnostic.at).toLocaleTimeString()}</summary><pre>{state.diagnostic.text}</pre></details>}
      </section>
    </div>
  </article>;
}
