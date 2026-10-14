import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  compressionLabels,
  type Compression,
} from "../../shared/compression.js";
import { Icon } from "../components.js";
import type { Selection } from "../../shared/agent.js";
import { ModelPicker } from "./ModelPicker.js";
import { CompressionSummary } from "./CompressionSummary.js";
import { AutoCompressionSettings } from "./AutoCompressionSettings.js";

export function compressionStatusLabel(job: Compression) {
  if (job.state === "completed") return "已应用";
  if (job.state !== "running") return compressionLabels[job.state];
  return {
    snapshot: "等待安全点快照",
    summarizing: "后台生成原生摘要",
    applying: "等待新的安全点应用",
    done: "确认应用结果",
  }[job.phase];
}

export function CompressionIcon({
  state,
  detail = false,
}: {
  state: string;
  detail?: boolean;
}) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <g data-state={state}>
        {state === "running" ? (
          <path d="M21 12a9 9 0 1 1-9-9" />
        ) : ["cancelled", "failed", "interrupted"].includes(state) ? (
          <path d="m6 6 12 12m0-12L6 18" />
        ) : detail && state === "completed" ? (
          <path d="m5 12 4 4L19 6" />
        ) : (
          <>
            <rect width="7" height="7" x="3" y="3" rx="1" />
            <rect width="7" height="7" x="3" y="14" rx="1" />
            <path d="M14 4h7" />
            <path d="M14 9h7" />
            <path d="M14 15h7" />
            <path d="M14 20h7" />
          </>
        )}
      </g>
    </svg>
  );
}
export function CompressionDetail({
  id,
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
  inherited,
  onSelect,
  startUnavailable,
  contextWindow,
}: {
  contextWindow?: number | null;
  id: string;
  job: Compression | null;
  selection: Selection | null;
  inherited: boolean;
  onSelect: (selection: Selection) => Promise<void>;
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
  const ref = useRef<HTMLDialogElement>(null),
    close = useRef<HTMLButtonElement>(null);
  const backdrop = useRef(false);
  const [now, setNow] = useState(Date.now());
  const active = job?.state === "running",
    done = job?.state === "completed";
  useEffect(() => {
    const trigger = document.activeElement as HTMLElement;
    ref.current!.showModal();
    close.current!.focus();
    return () => trigger?.focus({ preventScroll: true });
  }, []);
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active]);
  const steps = [
    [
      "等待安全点快照",
      !job || job.phase === "snapshot"
        ? "等待会话安全边界，保存完整上下文快照；不打断当前请求"
        : `快照包含 ${job.messageCount} 条上下文消息；快照后的新增消息单独保留`,
    ],
    ["后台生成原生摘要", "使用所选模型与 pi 原生压缩；不调用编码工具"],
    [
      "等待新的安全点应用",
      "校验快照仍兼容后自动应用；原始历史与新增消息保留，冲突不应用",
    ],
  ];
  const outside = (x: number, y: number) => {
    const box = ref.current!.getBoundingClientRect();
    return x < box.left || x > box.right || y < box.top || y > box.bottom;
  };
  // Outside usage/child layout: the sheet keeps the design's full-viewport geometry.
  return createPortal(
    <dialog
      ref={ref}
      id={id}
      className="compression-page"
      data-od-id="background-compression-page"
      aria-labelledby={`${id}-heading`}
      aria-describedby={`${id}-note`}
      onPointerDown={(e) => {
        backdrop.current = e.target === e.currentTarget && outside(e.clientX, e.clientY);
      }}
      onPointerCancel={() => { backdrop.current = false; }}
      onClick={(e) => {
        if (backdrop.current && e.target === e.currentTarget && outside(e.clientX, e.clientY)) onClose();
        backdrop.current = false;
      }}
      onCancel={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }}
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
          title="返回会话（Esc）"
          aria-label="关闭压缩详情，返回会话"
          onClick={onClose}
        >
          <Icon name="close" />
        </button>
      </header>
      <div className="compression-body">
        <section className="compression-settings" aria-label="压缩模型设置">
          <h3>压缩模型</h3>
          <ModelPicker nested value={selection} disabled={busy || pending} onSelect={onSelect} />
          <p>{inherited ? "尚未设置全局压缩模型，默认使用当前会话模型。" : "已全局记忆，主／子会话共用，刷新和重启后保留。"}选择仅用于压缩，不改变聊天模型。</p>
          {active && <p>本次任务：{job!.selection.provider} / {job!.selection.id}；修改模型仅影响下一次压缩。</p>}
        </section>
        <AutoCompressionSettings contextWindow={contextWindow} />
        <section>
          <div
            className="compression-status"
            data-state={job?.state ?? "idle"}
            role="status"
            aria-live="polite"
          >
            <CompressionIcon state={job?.state ?? "idle"} detail />
            <span>{job ? compressionStatusLabel(job) : "准备压缩"}{job?.trigger === "auto" ? " · 自动触发" : ""}</span>
          </div>
          <p>
            {!job ? "选择模型后点击开始压缩。摘要将在后台生成，并在安全点应用。" :
              (active
                ? job.phase === "snapshot"
                  ? "正在等待会话安全边界以保存快照，你可以返回会话继续操作。"
                  : job.phase === "summarizing"
                    ? "正在后台生成 pi 原生摘要，完成后将等待新的安全点自动应用。"
                    : "摘要已生成，正在等待安全边界校验并应用；尚未完成应用。"
                : done
                  ? "压缩摘要已应用到当前会话上下文，原始历史与快照后的新增消息均已保留。"
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
              <dt>压缩前 · pi 估算</dt>
              <dd className="num">
                {job?.before?.toLocaleString("zh-CN") ?? "—"} Token
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
              </dd>
            </div>
          </dl>
        </section>
        <section>
          <h3>处理阶段</h3>
          <ol className="compression-steps">
            {steps.map(([heading, description], i) => {
              const current = {
                snapshot: 0,
                summarizing: 1,
                applying: 2,
                done: 3,
              }[job?.phase ?? "snapshot"];
              const phase = !job ? "pending" : done || i < current
                ? "done"
                : i > current ? "pending"
                : active ? "current"
                : job.state === "failed" ? "failed" : "cancelled";
              const phaseLabel = {
                pending: "等待中", done: "已完成", current: "进行中",
                failed: "失败", cancelled: "已停止",
              }[phase];
              return (
                <li key={heading} data-phase={phase} aria-current={phase === "current" ? "step" : undefined}>
                  <span className="compression-step-number" aria-hidden="true">
                    {phase === "done" ? "✓" : phase === "failed" ? "!" : i + 1}
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
              pi · {done ? "已应用" : active ? "安全点自动应用" : "未应用"}
            </span>
          </div>
          <div className="card compression-preview">
            {job?.summary ? (
              <article>
                <h4 className="compression-preview-label">模型摘要 · {job.selection.id}</h4>
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
            本次任务基于安全点保存的上下文快照。应用后保留原始历史与快照后的新增消息；失败、取消或冲突时不应用摘要。
          </p>
          <p id={`${id}-note`} style={{ marginTop: 8 }}>
            摘要在后台生成，并在新的安全点自动应用。快照估算不包含后续新增消息，当前占用以会话圆环为准。
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
                  : "（摘要未应用；此处仅为该次请求明细）"}
            </p>
          )}
        </section>
      </div>
      <footer>
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
    document.body,
  );
}
