import { operationFeedback } from "../operation-feedback.js";
import { Icon } from "../Icon.js";
import { BackendMaintenance } from "../maintenance/BackendMaintenance.js";
import { ComponentActions, ComponentCard, ComponentConfirmation } from "../maintenance/ComponentCard.js";
import { componentInstallAction } from "../../shared/component-actions.js";
import { ManagedRuntimeCard } from "../maintenance/ManagedRuntimeCard.js";
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
  const [uninstall, setUninstall] = useState(false);
  const [reinstall, setReinstall] = useState<{ version: string }>();
  const [choice, setChoice] = useState<{ revision: string; enabled: boolean }>();
  const blocked = sending || !!coreJob?.running || !connection.connected;
  const busy = blocked || requests.length > 0 || jobs.some(job => job.running);
  // Component standard: install/update/uninstall stay available; only an in-flight request or a lost connection blocks them.
  const locked = sending || !connection.connected;
  useEffect(() => {
    if (!busy && focusAfterReconcile.current) { focusAfterReconcile.current = false; checkButton.current?.focus(); }
  }, [busy]);
  const target = state.latest ?? reaVersion;
  const installed = !!(state.version || state.packageRoot);
  const supported = state.supported || !state.nodeVersion && !state.supportError;
  const installAction = componentInstallAction({ label: "REA", installation: installed ? state.skillError || state.mcpError ? "incomplete" : "installed" : state.revision ? "missing" : "unknown", version: state.version, target, targetLabel: state.latest ? "最新" : "推荐", repairByReinstall: true });
  const referenceBlocker = !state.packageRoot ? installed ? "REA 安装路径不可用，请重新安装后再管理内置接入。" : "请先安装 REA，接入文件来自 REA 安装包。" : busy ? "REA 正在维护，完成或取消后可调整内置接入。" : undefined;
  useEffect(() => {
    if (active && connection.connected) void action("rea.refresh");
  }, [active, connection.connected, connection.generation]);
  async function action(op: string, params: Record<string, unknown> = {}, throwFailure = false) {
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
    } catch (error) { if (op === "rea.save") setChoice(undefined); report({ text: (error as Error).message, error: true }); if (throwFailure) throw error; }
    finally { setRequests(previous => previous.filter(item => item.id !== id)); }
  }
  const error = reinstall ? undefined : feedback?.error ? feedback.text : state.error || (!feedback ? coreJob?.error : undefined);
  const reportedErrorResources = jobs.filter(job => job.error && !feedbackByResource[job.engine ? `rea:${job.engine}` : "rea"] && maintenance.tasks.findLast(task => task.resource === (job.engine ? `rea:${job.engine}` : "rea"))?.id === job.id).map(job => job.engine ? `rea:${job.engine}` : "rea");
  return <article className="supplier-detail tools-detail" id="rea" aria-labelledby="rea-heading" style={active ? undefined : { display: "none" }}>
    <div className="tools-content">
      <BackendMaintenance resource="rea" label="REA" headingId="rea-heading" version={state.version ? `v${state.version}` : installed ? "已安装" : state.revision ? "未安装" : undefined} showError={!error && !reinstall} description="JavaScript、应用程序与二进制分析"
        environmentContent={<>
          {state.runtimeManaged && <ManagedRuntimeCard owner="REA" nodeVersion={state.nodeVersion} npmVersion={state.npmVersion} disabled={busy} onCheck={() => void action("rea.refresh")} />}
          <ComponentCard kind="skill" label="Skill" regionLabel="REA Skill维护" headingId="rea-skill-heading" description="reverse-engineer-anything · 逆向分析指南"
            version={state.skillInstalled ? state.version ? `v${state.version}` : "已安装" : state.revision ? "未安装" : undefined} availableVersion={state.version ? `v${state.version}` : undefined} availableVersionLabel="推荐" status={state.skillError ? "文件不完整" : undefined}
            actions={<ComponentActions context={{ connected: connection.connected, sending }} capabilities={[
              { id: "install", label: "安装 Skill", applicable: !state.skillInstalled || !!state.skillError, blockedReason: referenceBlocker, execute: () => void action("rea.installSkill", { revision: state.revision }) },
              { id: "uninstall", label: "卸载 Skill", applicable: state.skillInstalled, blockedReason: referenceBlocker, danger: true, execute: () => void action("rea.uninstallSkill", { revision: state.revision }) },
            ]} />}
            details={<p className="maintenance-note">从当前 REA 安装包接入技能及引用文档。卸载只移除内置引用，保留包内源文件和普通同名技能；已有会话需调整选择并重新加载。</p>}>
            {state.skillError && <p className="tools-error" role="alert">{state.skillError}</p>}
          </ComponentCard>
          <ComponentCard kind="mcp" label="MCP" regionLabel="REA MCP维护" headingId="rea-mcp-heading" description="rea · 逆向分析工具服务"
            version={state.mcpInstalled ? state.version ? `v${state.version}` : "已安装" : state.revision ? "未安装" : undefined} availableVersion={state.version ? `v${state.version}` : undefined} availableVersionLabel="推荐" status={state.mcpError ? "文件不完整" : undefined}
            actions={<ComponentActions context={{ connected: connection.connected, sending }} capabilities={[
              { id: "install", label: "安装 MCP", applicable: !state.mcpInstalled || !!state.mcpError, blockedReason: referenceBlocker, execute: () => void action("rea.installMcp", { revision: state.revision }) },
              { id: "uninstall", label: "卸载 MCP", applicable: state.mcpInstalled, blockedReason: referenceBlocker, danger: true, execute: () => void action("rea.uninstallMcp", { revision: state.revision }) },
            ]} />}
            details={<p className="maintenance-note">安装当前 REA 的内置连接；卸载保留 Skill、REA 程序和普通同名 MCP。已有会话需在技能与 MCP 面板调整选择并重新加载。</p>}>
            {state.mcpError && <p className="tools-error" role="alert">{state.mcpError}</p>}
          </ComponentCard>
          <ReaEngines state={state} busy={busy} blocked={blocked} sending={requests.map(item => item.resource)} feedback={feedbackByResource} action={action} reportedErrorResources={reportedErrorResources} />
        </>}
        actions={<ComponentActions context={{ connected: connection.connected, sending, taskRunning: busy }} capabilities={[
          { id: "check-install", label: "检查安装", buttonRef: checkButton, conflictsWithTask: true, execute: () => void action("rea.refresh") },
          { id: "check-versions", label: state.version ? "检查更新" : "检查版本", support: supported ? "supported" : "unsupported", conflictsWithTask: true, execute: () => void action("rea.check") },
          { ...installAction, support: supported ? "supported" : "unsupported", execute: () => { if (installed && installAction.id !== "update") setReinstall({ version: target }); else void action("rea.install"); } },
          { id: "uninstall", label: "卸载 REA", danger: true, execute: () => setUninstall(true) },
        ]} />}
        availableVersion={`v${target}`} availableVersionLabel={state.latest ? "最新" : "推荐"}
        location={state.packageRoot && <LocalPath path={state.packageRoot} />}
        summary={state.engineHost && <p className="maintenance-note">运行平台 · {({ win32: "Windows", darwin: "macOS", linux: "Linux" } as Record<string, string>)[state.engineHost.platform] ?? state.engineHost.platform} {state.engineHost.arch}</p>}
        details={!!state.cleanupUnverified?.length && <p className="maintenance-note">保留 {state.cleanupUnverified.length} 个归属未确认的旧目录。</p>}>
      <div className="tools-feedback" aria-live="polite">
        {sending ? <p role="status">{operationFeedback(requests.findLast(item => item.resource === "rea")!.op)}</p> : error ? <p className="tools-error" role="alert">{error}</p> : feedback?.text ? <p role="status">{feedback.text}</p> : null}
        {!connection.connected && <p>连接已断开；重连后读取当前操作进度。</p>}
      </div>
        {!state.supported && state.nodeVersion && <p className="tools-error">{state.supportError || "当前后台平台尚不支持内置工具进程。"}</p>}
        {reinstall && <ComponentConfirmation title="重新安装 REA 及专属环境？" description="现场解析最新版并重新安装 REA 及独立 Node/npm，可能降级；失败会清理托管程序后重试一次，不能保证保留原版本。默认设置、Skill/MCP 的安装选择与独立分析引擎保留。" confirmLabel="确认重新安装" confirmDisabled={locked} onClose={() => setReinstall(undefined)} onConfirm={async () => { await action("rea.install", {}, true); }} />}
        {uninstall && <div className="tools-conflict inline-confirmation" role="group" aria-label="确认卸载 REA">
          <p>移除 Axiom 托管的 REA 程序、专属环境及其技能、MCP 安装引用。保留默认设置、分析引擎与组件路径。确认后直接卸载，不等待或中断会话；正在使用这些资源的任务需自行处理资源缺失。</p>
          <div className="tools-actions"><button className="btn" onClick={() => setUninstall(false)}>暂不卸载</button><button className="btn confirm-danger" disabled={locked} onClick={() => { setUninstall(false); void action("rea.uninstall"); }}><Icon name="trash-2" />确认卸载</button></div>
        </div>}
      </BackendMaintenance>
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
      <section className="section tools-section" aria-labelledby="rea-doctor-heading">
        <div className="section-heading"><h3 id="rea-doctor-heading">连接检查</h3><p>检查版本、工具列表，并实际调用会话检查工具。</p></div>
        <button className="btn" disabled={busy || !!state.supportError || !state.version} onClick={() => void action("rea.doctor")}>检测 REA 连接</button>
        <p className="field-help tools-help">JavaScript 静态分析可直接使用。原生反编译需要另行配置 Hopper、Ghidra、IDA 等引擎；SQLite 分析需要 Node.js 24.15+（24.x）或 26+。</p>
        {state.diagnostic && <details className="tools-diagnostic" open><summary>连接报告 · {new Date(state.diagnostic.at).toLocaleTimeString()}</summary><pre>{state.diagnostic.text}</pre></details>}
      </section>
    </div>
  </article>;
}
