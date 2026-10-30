import { operationFeedback } from "../operation-feedback.js";
import { BackendMaintenance } from "../maintenance/BackendMaintenance.js";
import { ComponentActions } from "../maintenance/ComponentCard.js";
import { componentInstallAction } from "../../shared/component-actions.js";
import { useEffect, useState } from "react";
import { command, useConnectionState, useScope } from "../transport.js";
import { Select } from "../Select.js";
import { LocalPath } from "../LocalPath.js";
import { emptyRtkState, emptyRtkStats, rtkLevels, rtkPolicies, rtkReasons, type RtkSettings, type RtkState, type RtkStats } from "../../shared/rtk.js";
const bytes = (value: number) => value < 1024 ? `${value} B` : value < 1024 * 1024 ? `${(value / 1024).toFixed(1)} KiB` : `${(value / 1024 / 1024).toFixed(2)} MiB`;
const sameSettings = (a: RtkSettings, b: RtkSettings) => a.enabled === b.enabled && a.level === b.level && a.subagents === b.subagents;
export function RtkTool({ active }: { active: boolean }) {
  const state = useScope("builtin-tools:rtk", emptyRtkState), connection = useConnectionState();
  const [draft, setDraft] = useState<{ revision: string; settings: RtkSettings; baseSettings: RtkSettings }>();
  const [sending, setSending] = useState(false), [feedback, setFeedback] = useState<{ text: string; error?: boolean }>();
  const [days, setDays] = useState(7), [stats, setStats] = useState<RtkStats>(emptyRtkStats), [refresh, setRefresh] = useState(0);
  const [pendingOperation, setPendingOperation] = useState("");
  const [uninstall, setUninstall] = useState(false);
  const [clear, setClear] = useState<"Stats" | "Originals">();
  const settings = draft?.settings ?? state.settings, conflict = !!draft && draft.revision !== state.revision && !sameSettings(draft.baseSettings, state.settings);
  const busy = sending || !!state.job?.running || !connection.connected;
  // Component standard: install/update/uninstall stay available; only an in-flight request or a lost connection blocks them.
  const locked = sending || !connection.connected;
  useEffect(() => { if (active && connection.connected) void command("rtk.get").catch((e: Error) => setFeedback({ text: e.message, error: true })); }, [active, connection.connected, connection.generation]);
  useEffect(() => {
    if (!active || !connection.connected) return;
    let stopped = false, loading = false;
    const load = async () => {
      if (document.hidden || loading) return;
      loading = true;
      try { const value = await command("rtk.stats", { days }) as RtkStats; if (!stopped) setStats(value); }
      catch { if (!stopped) setStats(previous => ({ ...previous, error: "效果记录刷新失败，请检查连接后重试。" })); }
      finally { loading = false; }
    };
    void load(); const timer = setInterval(() => void load(), 5000);
    document.addEventListener("visibilitychange", load);
    return () => { stopped = true; clearInterval(timer); document.removeEventListener("visibilitychange", load); };
  }, [active, connection.connected, connection.generation, days, refresh]);
  const change = (patch: Partial<RtkSettings>) => { setDraft({ revision: draft?.revision ?? state.revision, baseSettings: draft?.baseSettings ?? { ...state.settings }, settings: { ...settings, ...patch } }); setFeedback(undefined); };
  async function action(op: string, params: Record<string, unknown> = {}) {
    setPendingOperation(op); setSending(true); setFeedback(undefined);
    try {
      await command(op, params);
      if (op === "rtk.save") { setDraft(undefined); setFeedback({ text: "设置已保存，将用于后续工具结果，包括已打开的会话。" }); }
      if (op.startsWith("rtk.clear")) { setClear(undefined); setRefresh(value => value + 1); setFeedback({ text: op === "rtk.clearStats" ? "效果记录已清空；后续执行会继续产生记录。" : "已清理当前保留的原文；聊天中的旧回查路径可能已失效。" }); }
    } catch (e) { setFeedback({ text: (e as Error).message, error: true }); }
    finally { setSending(false); }
  }
  const saving = Math.max(0, stats.inputBytes - stats.outputBytes), percent = stats.inputBytes ? saving / stats.inputBytes * 100 : 0;
  const error = sending ? undefined : feedback?.error ? feedback.text : state.error || state.job?.error;
  const installed = !!(state.executable || state.version), supported = state.supported || !state.platform && !state.supportError;
  const installAction = componentInstallAction({ label: "RTK", installation: installed ? "installed" : state.revision ? "missing" : "unknown", version: state.version, target: state.latest });
  const exportStats = () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify({ ...stats, exportedAt: new Date().toISOString(), measurement: "Postprocess-only observed UTF-8 tool text bytes including recall hint; rewrite bytes are unknown (zero sentinels), adoption is not measured savings; not billed tokens; rolling 5000 events / 30 days" }, null, 2)], { type: "application/json" }));
    const a = document.createElement("a"); a.href = url; a.download = "axiom-rtk-effects.json"; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return <article className="supplier-detail tools-detail" id="rtk" aria-labelledby="rtk-heading" style={active ? undefined : { display: "none" }}>
    <div className="tools-content">
      <BackendMaintenance resource="rtk" label="RTK" headingId="rtk-heading" version={state.version ? `v${state.version}` : installed ? "已安装" : state.revision ? "未安装" : undefined} description="官方 RTK 前置重写与安全后处理" showError={!error}
        actions={<ComponentActions context={{ connected: connection.connected, sending, taskRunning: !!state.job?.running }} capabilities={[
          { id: "check-versions", label: state.executable ? "检查 RTK 更新" : "检查 RTK 版本", support: supported ? "supported" : "unsupported", conflictsWithTask: true, execute: () => void action("rtk.check") },
          { ...installAction, support: supported ? "supported" : "unsupported", execute: () => void action("rtk.install") },
          { id: "check-environment", label: "运行自检", applicable: !!state.executable, blockedReason: state.supportError, conflictsWithTask: true, execute: () => void action("rtk.doctor") },
          { id: "uninstall", label: "卸载 RTK", danger: true, execute: () => setUninstall(true) },
        ]} />}
        availableVersion={state.latest ? `v${state.latest}` : undefined} availableVersionLabel="最新"
        location={state.executable && <LocalPath path={state.executable} />}
        details={<>
          <p className="maintenance-note">平台 · {state.platform || "读取中"}</p>
          {state.diagnostic && <p className="maintenance-note">{state.diagnostic.text} · {new Date(state.diagnostic.at).toLocaleString()}</p>}
        </>}>
      <div className="tools-feedback" aria-live="polite">{error ? <p className="tools-error" role="alert">{error}</p> : sending || feedback?.text ? <p role="status">{sending ? operationFeedback(pendingOperation) : feedback?.text}</p> : null}{!connection.connected && <p>连接已断开；重连后读取当前进度。</p>}</div>
        {state.supportError && <p className="field-help">{state.supportError}</p>}
        {uninstall && <div className="tools-conflict inline-confirmation" role="group" aria-label="确认卸载 RTK"><p>将删除 Axiom 托管的 RTK {state.version ? `v${state.version}` : "程序"}及旧版本，保留过滤设置、效果记录和原文。进行中的 RTK 操作会被中止。</p><div className="tools-actions"><button className="btn" onClick={() => setUninstall(false)}>取消</button><button className="btn confirm-danger" disabled={locked} onClick={() => { setUninstall(false); void action("rtk.uninstall"); }}>确认卸载</button></div></div>}
      </BackendMaintenance>
      <section className="section tools-section" aria-labelledby="rtk-settings-heading">
        <div className="section-heading"><h3 id="rtk-settings-heading">过滤设置</h3><p>等级由 Axiom 控制过滤范围和门槛</p></div>
        <fieldset className="tools-fields" disabled={busy}>
          <label className="tools-toggle"><input type="checkbox" checked={settings.enabled} onChange={e => change({ enabled: e.target.checked })} /><span><strong>启用 RTK 输出过滤</strong><small>默认 Bash 的已验证命令经原始与改写双重权限检查后透明重写；自定义 shell、前缀和嵌套调用不改写。未重写时，仅后处理可识别的成功输出。</small></span></label>
          <div className="field"><label htmlFor="rtk-level">过滤等级</label><Select id="rtk-level" label="过滤等级" value={settings.level} disabled={busy} options={rtkLevels.map(value => ({ value, label: rtkPolicies[value].label }))} onChange={value => change({ level: value as RtkSettings["level"] })} /><p className="field-help">{rtkPolicies[settings.level].description}</p></div>
          <label className="tools-toggle"><input type="checkbox" checked={settings.subagents} onChange={e => change({ subagents: e.target.checked })} /><span><strong>同时用于子代理</strong><small>主、子代理沿用相同等级。Read、MCP 工具以及无法确认格式的自定义 shell 输出不处理。</small></span></label>
        </fieldset>
        {conflict && <div className="tools-conflict" role="status"><p>配置已在其他窗口修改；当前输入已保留。</p><button className="btn" disabled={busy} onClick={() => void action("rtk.save", { ...settings, revision: state.revision })}>用当前输入保存</button></div>}
        <div className="configuration-actions"><button className="btn btn-primary" disabled={busy || !draft || conflict} onClick={() => void action("rtk.save", { ...settings, revision: state.revision })}>保存过滤设置</button><button className="btn btn-ghost" disabled={busy || !draft} onClick={() => { setDraft(undefined); setFeedback(undefined); }}>放弃修改</button><span className="save-state" data-dirty={!!draft}>{draft ? "有未保存的修改" : "已保存"}</span></div>
        <p className="field-help tools-help">过滤是有损的。前置重写直接执行官方 RTK，仅保留其返回结果，无法恢复未观察到的未压缩原文；不会为回查重跑命令。仅后处理在采用前保存原始工具文本并附回查路径，保留 7 天、最多 200 条。原文可能含敏感信息，仅存于本机。关闭后不再生成效果记录和原文。</p>
      </section>
      <section className="section tools-section" aria-labelledby="rtk-effects-heading">
        <div className="section-heading"><h3 id="rtk-effects-heading">效果观察</h3><p>前置仅统计改写检查与采用次数，不估算节省。下方字节只统计后处理实测文本（含回查提示），不是完整进程输出或账单节省。</p></div>
        <div className="tools-actions"><Select label="统计时间范围" value={String(days)} options={[1, 7, 30].map(value => ({ value: String(value), label: `最近 ${value} 天` }))} onChange={value => setDays(Number(value))} /><button className="btn" disabled={!connection.connected} onClick={() => setRefresh(value => value + 1)}>刷新效果</button><button className="btn" disabled={!(stats.count || stats.rewriteCount) || !!stats.error} onClick={exportStats}>导出效果 JSON</button></div>
        {stats.error ? <p className="tools-error" role="alert">{stats.error}</p> : <>
          <dl className="tools-facts rtk-metrics"><div><dt>后处理净缩减</dt><dd>{bytes(saving)} · {percent.toFixed(1)}%</dd></div><div><dt>后处理已缩减 / 已观察</dt><dd>{stats.filtered} / {stats.count} 次</dd></div><div><dt>后处理前 → 返回模型</dt><dd>{bytes(stats.inputBytes)} → {bytes(stats.outputBytes)}</dd></div><div><dt>后处理平均耗时</dt><dd>{stats.count ? (stats.durationMs / stats.count).toFixed(1) : "0"} ms</dd></div></dl>
          <p className="field-help">前置改写采用 {stats.rewritten ?? 0} / 检查 {stats.rewriteCount ?? 0} 次；改写与权限检查平均 {stats.rewriteCount ? (stats.rewriteDurationMs / stats.rewriteCount).toFixed(1) : "0"} ms。采用不代表已测得节省。</p>
          {stats.count || stats.rewriteCount ? <><div className="rtk-saving" role="img" aria-label={`工具文本净缩减 ${percent.toFixed(1)}%`}><span style={{ width: `${percent}%` }} /></div><p className="field-help">{stats.reasons.map(item => `${rtkReasons[item.reason]} ${item.count}`).join(" · ")}</p><details className="tools-diagnostic"><summary>最近 {stats.recent.length} 条记录</summary><div className="rtk-table"><table><thead><tr><th>时间 / 执行者</th><th>等级 / 过滤器</th><th>结果</th><th>前 → 后</th><th>耗时</th></tr></thead><tbody>{stats.recent.map(event => <tr key={event.id}><td>{new Date(event.at).toLocaleTimeString()}<small>{event.role === "main" ? "主代理" : "子代理"}</small></td><td>{rtkPolicies[event.level].label}<small>{event.filter || "—"}</small></td><td>{rtkReasons[event.reason]}</td><td>{event.stage === "rewrite" ? "前置 · 字节未测量" : `${bytes(event.inputBytes)} → ${bytes(event.outputBytes)}`}</td><td>{event.durationMs.toFixed(1)} ms</td></tr>)}</tbody></table></div></details></> : <p className="field-help">尚无效果记录。启用后执行工具即可观察；只有支持的格式且达到门槛时才会缩减。</p>}
        </>}
        <p className="field-help tools-help">每 5 秒刷新。效果记录滚动保留 30 天、最多 5,000 条；不记录命令正文、参数或输出。导出包含当前汇总和最近 50 条记录。停用不会清除历史。清理不删除已保存在聊天记录中的文本。</p>
        <div className="tools-actions"><button className="btn" disabled={busy} onClick={() => setClear("Stats")}>清空效果记录</button><button className="btn" disabled={busy} onClick={() => setClear("Originals")}>清理保留原文</button></div>
        {clear && <div className="tools-conflict inline-confirmation" role="alert"><p>{clear === "Stats" ? "将清空所有 RTK 效果记录，保留原文和过滤设置。后续执行仍会产生新记录。" : "将删除当前保留的 RTK 原文文件，旧聊天的回查路径会失效。正在执行的工具仍可能产生新文件。"}</p><div className="tools-actions"><button className="btn" disabled={busy} onClick={() => setClear(undefined)}>取消</button><button className="btn confirm-danger" disabled={busy} onClick={() => void action(`rtk.clear${clear}`, { confirm: true })}>确认清理</button></div></div>}
      </section>
    </div>
  </article>;
}
