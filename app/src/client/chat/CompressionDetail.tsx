import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import {
  compressionLabels,
  type Compression,
} from "../../shared/compression.js";
import { Icon } from "../components.js";
import { CompressionProgressIcon } from "../DataIcons.js";
import { BubbleLoadingIcon } from "../StatusIcons.js";
import type { Selection } from "../../shared/agent.js";
import { CompressionSummary } from "./CompressionSummary.js";
import { AutoCompressionSettings } from "./AutoCompressionSettings.js";
import { ProcessingPage } from "../pages/ProcessingPage.js";
import type { Scope } from "../../shared/protocol.js";
import { useSettingsPopover } from "../useSettingsPopover.js";
import { useModelDisplay } from "../useModelDisplay.js";
import { contextSourceLabel } from "../../shared/context-usage.js";

export function compressionStatusLabel(job: Compression) {
  if (job.state === "completed") return job.phase === "done" ? "已应用" : "应用状态待核实";
  if (job.state !== "running") return compressionLabels[job.state];
  if (job.stage) return job.stage;
  return {
    snapshot: "等待安全点快照",
    summarizing: "后台生成原生摘要",
    applying: "等待新的安全点应用",
    done: "确认应用结果",
  }[job.phase];
}

export function CompressionIcon({ state, phase, detail: _detail = false }: { state: string; phase?: string; detail?: boolean }) {
  return state === "idle" || (state === "completed" && phase === "done") ? <Icon name="fold" /> : <CompressionProgressIcon state={state} phase={phase} />;
}
// Official Lucide paths: https://lucide.dev/icons/ (ISC; see ICONS-LICENSE.txt).
function CompressionStepIcon({ phase, step }: { phase: string; step: number }) {
  if (phase === "current") return <BubbleLoadingIcon />;
  return <svg className="ui-glyph" aria-hidden="true" viewBox={phase === "done" ? "3 5 18 13" : phase === "failed" ? "1 2 22 20" : phase === "cancelled" ? "2 2 20 20" : step === 0 ? "1 1 22 22" : step === 1 ? "3 1 18 22" : "2 4 20 16"} fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
    {phase === "done" ? <path d="M20 6 9 17l-5-5" />
      : phase === "failed" ? <><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3" /><path d="M12 9v4" /><path d="M12 17h.01" /></>
      : phase === "cancelled" ? <rect width="18" height="18" x="3" y="3" rx="2" />
      : step === 0 ? <><rect width="14" height="14" x="8" y="8" rx="2" ry="2" /><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" /></>
      : step === 1 ? <><path d="M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z" /><path d="M14 2v5a1 1 0 0 0 1 1h5" /><path d="M10 9H8" /><path d="M16 13H8" /><path d="M16 17H8" /></>
      : <><path d="M13 5h8" /><path d="M13 12h8" /><path d="M13 19h8" /><path d="m3 17 2 2 4-4" /><path d="m3 7 2 2 4-4" /></>}
  </svg>;
}

export function CompressionDetail({
  id,
  trigger,
  job,
  title,
  busy,
  error,
  pending,
  onReconcile,
  onClose,
  onStart,
  onCancel,
  selection,
  startUnavailable,
  contextWindow,
  scope,
}: {
  scope?: Scope | null;
  contextWindow?: number | null;
  id: string;
  trigger: HTMLButtonElement;
  job: Compression | null;
  selection: Selection | null;
  startUnavailable: string;
  title: string;
  busy: boolean;
  error: string;
  pending: boolean;
  onReconcile: () => void;
  onClose: () => void;
  onStart: () => void;
  onCancel: () => void;
}) {
  const { panel, close, host } = useSettingsPopover(trigger, onClose);
  const display = useModelDisplay();
  const [records, setRecords] = useState(false);
  const [now, setNow] = useState(Date.now());
  const active = job?.state === "running",
    done = job?.state === "completed" && job.phase === "done",
    uncertain = job?.state === "completed" && !done;
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active]);
  const steps = [
    [
      "等待安全点快照",
      !job || !job.messageCount
        ? "运行中等待安全边界，不打断当前请求；会话已停止时立即保存全部当前上下文"
        : `快照包含 ${job.messageCount} 条上下文消息；快照后的新增消息单独保留`,
    ],
    ["后台生成原生摘要", "使用当前会话模型生成 pi 原生摘要；不执行编码工具"],
    [
      "等待新的安全点应用",
      "摘要在安全点直接应用，不校验快照兼容性；原始历史与新增消息保留",
    ],
  ];
  return createPortal(
    <dialog
      ref={panel}
      open
      popover="auto"
      id={id}
      className={`compression-page${records ? " processing-dialog" : ""}`}
      data-od-id="background-compression-page"
      aria-labelledby={`${id}-heading`}
      aria-describedby={`${id}-note`}
      onKeyDown={(e) => {
        e.stopPropagation();
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k")
          e.preventDefault();
      }}
    >
      <header>
        <div>
          <h2 id={`${id}-heading`}>后台压缩</h2>
          <p>当前会话 · 压缩设置与任务</p>
        </div>
        <button
          ref={close}
          type="button"
          className="icon-btn"
          data-tooltip="返回会话（Esc）"
          aria-label="关闭压缩详情，返回会话"
          onClick={onClose}
        >
          <Icon name="close" />
        </button>
      </header>
      {records && scope && <div className="compression-body"><ProcessingPage key={scope.workspaceId + scope.sessionId} workspaceId={scope.workspaceId} initial={{ kind: "compression", sessionId: scope.sessionId, id: job?.id }} onBack={() => setRecords(false)} /></div>}
      <div className="compression-body" hidden={records}>
        {scope && <button className="btn" onClick={() => setRecords(true)}>处理记录</button>}
        <section className="compression-settings" aria-label="会话压缩模型">
          <h3>使用会话模型</h3>
          <p>{selection ? display(selection).label : "尚未选择会话模型"}；压缩与会话使用相同模型和思考等级，无需单独配置。</p>
          {active && <p>本次任务：{display(job!.selection).label}；切换会话模型仅影响下一次压缩。</p>}
        </section>
        <AutoCompressionSettings contextWindow={contextWindow} />
        <section>
          <div
            className="compression-status"
            data-state={job?.state ?? "idle"}
            role="status"
            aria-live="polite"
          >
            <CompressionIcon state={job?.state ?? "idle"} phase={job?.phase} detail />
            <span>{job ? compressionStatusLabel(job) : "准备压缩"}{job?.trigger === "auto" ? " · 自动触发" : ""}</span>
          </div>
          <p>
            {!job ? "点击开始压缩，使用当前会话模型在后台生成摘要，并在安全点应用。" :
              (active
                ? job.phase === "snapshot"
                  ? "正在等待会话安全边界以保存快照，你可以返回会话继续操作。"
                  : job.phase === "summarizing"
                    ? "正在后台生成 pi 原生摘要，完成后将等待新的安全点自动应用。"
                    : "摘要已生成，正在等待安全点直接应用；尚未完成应用。"
                : done
                  ? "压缩摘要已应用到当前会话上下文，原始历史与快照后的新增消息均已保留。"
                  : uncertain ? "应用状态待核实，请以后台确认结果为准；原始历史保留。"
                  : "任务已停止，本次摘要未应用；原始历史与新增消息保留。")}
          </p>
          {(job?.error || job?.state === "failed" || job?.state === "interrupted") && (
            <div className="compression-error" role="alert">
              <strong>{job?.state === "failed" ? "失败原因" : job?.state === "interrupted" ? "中断原因" : "任务说明"}</strong>
              <p>{job?.error?.trim() || "未收到具体错误原因，请检查模型配置和服务状态后重试。"}</p>
            </div>
          )}
          {error && <p role="status">{error}</p>}
          {!active && startUnavailable && <p role="status">{startUnavailable}</p>}
          {pending && (
            <button
              className="btn"
              type="button"
              disabled={busy}
              onClick={onReconcile}
            >
              核实压缩状态（不重发）
            </button>
          )}
          {job?.stage && job.state !== "running" && <p className="meta">最后阶段：{job.stage}</p>}
          <dl className="compression-facts">
            <div>
              <dt>所属会话</dt>
              <dd>{title}</dd>
            </div>
            <div>
              <dt>已用时间</dt>
              <dd className="num">
                {job ? `${Math.max(0, ((job.endedAt ?? now) - job.startedAt) / 1000).toFixed(0)}s` : "—"}
              </dd>
            </div>
            <div>
              <dt>压缩前 · {job?.snapshot ? "上下文快照" : job?.before != null ? "历史估算" : "等待快照"}</dt>
              <dd className="num">
                {job?.before == null ? "—" : `${job.before.toLocaleString("zh-CN")} Token`}
              </dd>
            </div>
            <div>
              <dt>压缩后 · 快照估算</dt>
              <dd>
                {job?.after == null
                  ? active
                    ? "等待结果"
                    : "—"
                  : `${job.after.toLocaleString("zh-CN")} Token`}
                {job?.after != null && <div className="meta">{done ? "摘要已应用；当前占用另计" : uncertain ? "应用状态待核实" : active ? "尚未应用" : "未应用"}</div>}
              </dd>
            </div>
            {job?.before != null && <>
              <div>
                <dt>统计来源</dt>
                <dd>{contextSourceLabel(job.snapshot?.source)}</dd>
              </div>
              <div>
                <dt>快照时间</dt>
                <dd>{job.snapshot?.capturedAt == null ? "未记录" : <time dateTime={new Date(job.snapshot.capturedAt).toISOString()}>{new Date(job.snapshot.capturedAt).toLocaleString("zh-CN", { hour12: false })}</time>}</dd>
              </div>
            </>}
          </dl>
        </section>
        <section>
          <h3>处理阶段</h3>
          <ol className="compression-steps">
            {steps.map(([heading, description], i) => {
              const current = job?.phase === "snapshot" && job.messageCount > 0 ? 1 : Math.min(2, {
                snapshot: 0,
                summarizing: 1,
                applying: 2,
                done: 2,
              }[job?.phase ?? "snapshot"]);
              const phase = !job || uncertain ? "pending" : done || i < current
                ? "done"
                : i > current ? "pending"
                : active ? "current"
                : ["failed", "interrupted"].includes(job.state) ? "failed" : "cancelled";
              const phaseLabel = {
                pending: "等待中", done: "已完成", current: "进行中",
                failed: job?.state === "interrupted" ? "中断" : "失败", cancelled: "已停止",
              }[phase];
              return (
                <li key={heading} data-phase={phase} aria-current={phase === "current" ? "step" : undefined}>
                  <span className="compression-step-icon" aria-hidden="true">
                    <CompressionStepIcon phase={phase} step={i} />
                  </span>
                  <div>
                    <strong>{heading}<span className="screen-reader"> · {phaseLabel}</span></strong>
                    <small>{description}</small>
                  </div>
                </li>
              );
            })}
          </ol>
        </section>
        <section>
          <div className="row-between">
            <h3>压缩摘要</h3>
            <span className="meta">
              pi · {done ? "已应用" : uncertain ? "应用状态待核实" : active ? "安全点自动应用" : "未应用"}
            </span>
          </div>
          <div className="card compression-preview">
            {job?.summary ? (
              <article>
                <h4 className="compression-preview-label">模型摘要 · {display(job.selection).model}</h4>
                <CompressionSummary text={job.summary} />
              </article>
            ) : (
              <p>
                {active
                  ? "摘要尚未生成，生成后将在这里展示；应用结果以任务状态为准。"
                  : job ? "本次任务没有已确认的摘要。" : "开始压缩后，摘要与应用结果将在这里展示。"}
              </p>
            )}
          </div>
        </section>
        <section>
          <h3>上下文保留</h3>
          <p style={{ marginTop: 8 }}>
            运行中按自动压缩流程在安全点处理；会话已停止时立即压缩全部当前上下文。缓存前缀不可用或过大时改用原生摘要，必要时分批生成。应用后保留原始历史与快照后的新增消息；生成失败或取消时不应用摘要。
          </p>
          <p id={`${id}-note`} style={{ marginTop: 8 }}>
            压缩前读数固定在快照保存时，不随摘要生成或后续聊天变化。压缩后为摘要替换该快照的估算，不包含快照后的新增消息，也不代表摘要已应用；当前占用以会话上下文卡片为准。
          </p>
          {job?.usage && (
            <p style={{ marginTop: 8 }}>
              本次摘要用量：{job.usage.total.toLocaleString("zh-CN")} Token ·
              预计花费{" "}
              {job.usage.cost == null ? "—" : `US$${job.usage.cost.toFixed(4)}`}
              {done
                ? "（已计入所属 pi 会话统计；此处为该次明细，请勿重复相加）"
                : active
                  ? "（应用后计入所属 pi 会话统计；此处仅为该次明细）"
                  : uncertain ? "（应用状态待核实；此处仅为该次请求明细）"
                  : "（摘要未应用；此处仅为该次请求明细）"}
            </p>
          )}
        </section>
      </div>
      <footer hidden={records}>
        <small>
          {active ? "返回会话不影响后台任务" : "压缩不会删除原始历史"}
        </small>
        <div className="compression-actions">
          {active && <button type="button" className="btn" disabled={busy || pending} onClick={onCancel}>取消压缩</button>}
          <button
            type="button"
            className="btn"
            disabled={busy || pending || active || !!startUnavailable}
            onClick={onStart}
          >
            {active ? "压缩进行中" : job ? "再次压缩" : "开始压缩"}
          </button>
        </div>
      </footer>
    </dialog>,
    host,
  );
}
