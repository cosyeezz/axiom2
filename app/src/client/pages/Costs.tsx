import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useSettingsPopover } from "../useSettingsPopover.js";
import { command, useConnectionState, useScope } from "../transport.js";
import { costAmount, costCategories, costLabels, costPartLabels, costParts, costsScope, sumCosts, type CostReport, type CostRow, type CostTotals } from "../../shared/costs.js";
import { AppError, type Scope } from "../../shared/protocol.js";
import "../styles/costs.css";

const emptyRevision = { revision: 0 };
const number = (value: number) => value.toLocaleString("zh-CN");
function Breakdown({ row }: { row: CostRow }) {
  return <details className="cost-line">
    <summary><span><strong>{row.model ?? "模型未记录"}</strong><small>{row.provider ?? "供应商未记录"} · {row.records} 条用量记录</small></span><strong className="cost-number">{costAmount(row)}</strong></summary>
    <div className="cost-breakdown">
      <table><caption>按 Token 类型计算 · 美元</caption><thead><tr><th>类型</th><th>已知 Token</th><th>折算单价 / 百万</th><th>已知费用</th></tr></thead>
        <tbody>{costParts.map((part) => <tr key={part}><th>{costPartLabels[part]}</th><td>{number(row.tokens[part])}</td>
          <td>{!row.unknownParts && !row.unknownTokens && row.tokens[part] > 0 ? `$${(row.parts[part] / row.tokens[part] * 1_000_000).toFixed(4)}` : "—"}</td>
          <td>{row.unknownParts && !row.parts[part] ? "—" : `$${row.parts[part].toFixed(6)}`}</td></tr>)}</tbody></table>
      {!!row.unknownTokens && <p>部分记录未提供完整 Token 明细，表内仅列已知数量。</p>}
      {!!row.unknownParts && <p>部分记录缺少分项价格；已知总额仍计入汇总，不能据此推算各项单价。</p>}
      <p>折算单价 = 已记录分项费用 ÷ 对应 Token × 1,000,000；多次请求或阶梯价格会形成加权均价。</p>
    </div>
  </details>;
}
function Amount({ value }: { value: CostTotals }) {
  return <strong className="cost-number">{costAmount(value)}</strong>;
}
function Report({ report }: { report: CostReport }) {
  const totals = Object.fromEntries(costCategories.map((category) => [category, sumCosts(report.rows.filter((row) => row.category === category))]));
  const sessionTitle = (id: string) => report.sessions.find((session) => session.id === id)?.title ?? "未知会话";
  const children = report.sessions.filter((session) => session.taskId);
  return <>
    <section className="cost-overview" aria-label="费用汇总">
      <div className="cost-total"><span>累计预计费用 · USD</span><Amount value={report.total} />
        <p>{report.total.records ? `${report.total.records} 条用量记录 · ${children.length} 个子 Agent` : "尚无模型用量记录"}</p>
        {!!report.total.unknownCost && <p className="cost-caution">{report.total.unknownCost} 条记录的价格或用量未知，当前金额不代表完整费用。</p>}
      </div>
      <div className="cost-equation">{costCategories.filter((category) => category !== "other" || totals.other.records).map((category) =>
        <a href={`#cost-${category}`} key={category}><span>{costLabels[category]}</span><Amount value={totals[category]} /></a>)}</div>
    </section>
    {report.warnings.length > 0 && <div role="alert" className="cost-warning">{report.warnings.map((warning) => <p key={warning}>{warning}</p>)}</div>}
    <section id="cost-main" className="cost-section">
      <header><div><h2>主 Agent</h2><p>主会话的对话模型请求，压缩与工具内部调用另列。</p></div><Amount value={totals.main} /></header>
      {report.rows.filter((row) => row.category === "main").map((row) => <Breakdown key={row.id} row={row} />)}
      {!totals.main.records && <p className="cost-empty">暂无主 Agent 用量记录。</p>}
    </section>
    <section id="cost-subagent" className="cost-section">
      <header><div><h2>子 Agent <span>{children.length}</span></h2><p>逐个子任务累计，包含同一子会话后续追问的模型用量。</p></div><Amount value={totals.subagent} /></header>
      {children.map((child, index) => {
        const rows = report.rows.filter((row) => row.category === "subagent" && row.sessionId === child.id);
        return <article className="cost-source" key={child.id} data-session-id={child.id}>
          <div className="cost-source-heading"><div><h3><span className="cost-index">{String(index + 1).padStart(2, "0")}</span>{child.title}</h3><p>{({ queued: "排队中", starting: "启动中", running: "运行中", stopping: "停止中", completed: "已完成", failed: "失败", cancelled: "已取消", interrupted: "已中断" } as Record<string, string>)[child.status ?? ""] ?? "状态未知"}{child.id === report.requestedSessionId ? " · 当前查看的子会话" : ""}</p></div><Amount value={sumCosts(rows)} /></div>
          {rows.map((row) => <Breakdown key={row.id} row={row} />)}
          {!rows.length && <p className="cost-empty">暂无已记录用量；排队或尚未返回的请求不计作零费用。</p>}
        </article>;
      })}
      {!children.length && <p className="cost-empty">此主会话尚未委派子 Agent。</p>}
    </section>
    {(["compression", "tool", "other"] as const).map((category) => {
      const rows = report.rows.filter((row) => row.category === category);
      if (category === "other" && !rows.length) return null;
      return <section id={`cost-${category}`} className="cost-section" key={category}>
        <header><div><h2>{costLabels[category]}</h2><p>{category === "compression" ? "主／子会话全部压缩，已应用与未应用的费用均只计一次。" : category === "tool" ? "工具自身上报的模型用量，按工具名称与所属会话归集。" : "其他已记录的模型用量，独立计入总额。"}</p></div><Amount value={totals[category]} /></header>
        {rows.map((row) => <article className="cost-source" key={row.id}>
          <div className="cost-source-heading"><div><h3>{row.source}{row.timestamp != null && <time dateTime={new Date(row.timestamp).toISOString()}> · {new Date(row.timestamp).toLocaleString("zh-CN", { hour12: false })}</time>}</h3><p>{sessionTitle(row.sessionId)}{row.status ? ` · ${row.status}` : ""}</p></div></div>
          <Breakdown row={row} />
        </article>)}
        {!rows.length && <p className="cost-empty">{category === "tool" ? "暂无工具上报用量。未上报的内部模型调用无法自动计入。" : "暂无压缩用量记录。"}</p>}
      </section>;
    })}
    <section className="cost-method" aria-labelledby="cost-method-title"><h2 id="cost-method-title">计算口径</h2>
      <p>总费用 = 主 Agent + 全部子 Agent + 压缩 + 工具内部调用 + 其他模型调用。各分类互不重复。</p>
      <p>单次费用 = 输入、输出、缓存读取、缓存写入各自的 Token × 对应每百万 Token 单价 ÷ 1,000,000。使用请求时记录的费用，不以当前模型价格重算历史；阶梯价和缓存策略以模型记录为准。</p>
      <p>保留压缩前、重试及历史分支的已记录消费。失败、取消或未应用摘要不等于未消费；没有返回的用量无法推断。压缩任务的“用量记录”可能合并多次摘要请求。</p>
      <p>输入框金额为当前会话累计，本页为整个主会话及所属子任务的分类汇总。金额保留四位小数，分项保留六位；未知价格显示未知，实际扣款以供应商账单为准。</p>
    </section>
  </>;
}
function CostPage({ scope, closeControl }: { scope: Scope; closeControl?: ReactNode }) {
  const revision = useScope(costsScope(scope), emptyRevision);
  const connection = useConnectionState();
  const [report, setReport] = useState<CostReport | null>(null), [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0), [loading, setLoading] = useState(true);
  const refresh = useRef<(() => void) | null>(null);
  useEffect(() => {
    if (!connection.connected) return;
    let active = true, inFlight = false, dirty = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    // Keep the first deadline under continuous notifications. Serialize reads and
    // remember invalidations received while a query is in flight.
    const schedule = () => {
      dirty = true;
      if (!active || inFlight || timer !== undefined) return;
      timer = setTimeout(() => {
        timer = undefined;
        dirty = false;
        inFlight = true;
        setLoading(true);
        void command<CostReport>("costs.get", {}, scope).then((value) => {
          if (active) { setReport(value); setError(""); }
        }).catch((reason: Error) => {
          if (active) setError(reason instanceof AppError && reason.code === "UNKNOWN_OPERATION" ? "当前后台尚未支持费用明细，请在任务结束后重启后台服务。" : reason.message);
        }).finally(() => {
          inFlight = false;
          if (!active) return;
          setLoading(false);
          if (dirty) schedule();
        });
      }, 150);
    };
    refresh.current = schedule;
    schedule();
    return () => { active = false; clearTimeout(timer); refresh.current = null; };
  }, [scope.workspaceId, scope.sessionId, connection.connected, connection.generation]);
  useEffect(() => { refresh.current?.(); }, [revision.revision, attempt]);
  return <div className="cost-page">
    <header className="cost-topbar"><div className="cost-heading"><span>用量与账单</span><strong>费用明细</strong></div><div className="cost-actions">
      <button className="cost-refresh" type="button" aria-label="刷新费用" aria-busy={loading} disabled={!connection.connected || loading} onClick={() => setAttempt((value) => value + 1)}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 7v5h-5M4 17v-5h5" /><path d="M6.1 7a7 7 0 0 1 11.55-2L20 8M4 16l2.35 3A7 7 0 0 0 17.9 17" /></svg><span>{loading ? "更新中" : "刷新"}</span>
      </button>{closeControl ?? <a className="cost-back" href="/">返回工作台</a>}
    </div></header>
    <div className="cost-content">
      <div className="cost-title"><p>会话费用</p><h1>{report?.title ?? "费用明细"}</h1><span>主 Agent、子 Agent 与模型调用的累计明细</span></div>
      <p className="cost-status" role="status">{!connection.connected ? "连接已断开或正在连接，显示的费用可能尚未更新。" : loading ? "正在读取费用记录…" : report ? `更新于 ${new Date(report.updatedAt).toLocaleTimeString("zh-CN")} · 用量变化时自动更新` : "尚未读取费用"}</p>
      {error && <div className="cost-warning" role="alert"><p>{error}</p><button className="cost-refresh" type="button" disabled={!connection.connected || loading} onClick={() => setAttempt((value) => value + 1)}>重新加载</button></div>}
      {report && <Report report={report} />}
    </div>
  </div>;
}
export function CostsPopover({ scope, trigger, onClose }: { scope: Scope; trigger: HTMLButtonElement; onClose: () => void }) {
  const { panel, close, host } = useSettingsPopover(trigger, onClose);
  return createPortal(<dialog ref={panel} open popover="auto" className="cost-popover" aria-label="费用明细" onKeyDown={(event) => {
    event.stopPropagation();
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") event.preventDefault();
  }}>
    <CostPage scope={scope} closeControl={<button ref={close} type="button" className="cost-close action-icon" aria-label="关闭费用明细" data-tooltip="关闭（Esc）" onClick={onClose}>
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M6 18 18 6" /></svg>
    </button>} />
  </dialog>, host);
}
export default function Costs() {
  const params = new URLSearchParams(location.search);
  const workspaceId = params.get("workspaceId"), sessionId = params.get("sessionId");
  return workspaceId && sessionId ? <CostPage scope={{ workspaceId, sessionId }} /> : <main className="cost-page cost-content"><h1>费用明细</h1><p role="alert">缺少会话信息，请从会话输入框下方的费用入口打开。</p><a href="/">返回工作台</a></main>;
}
