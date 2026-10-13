import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  compressionLabels,
  type Compression,
} from "../../shared/compression.js";
import { Icon } from "../components.js";

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
        ) : detail ? (
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
  onAction,
}: {
  id: string;
  job: Compression;
  title: string;
  busy: boolean;
  error: string;
  pending: boolean;
  onReconcile: () => void;
  onClose: () => void;
  onAction: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null),
    close = useRef<HTMLButtonElement>(null);
  const [now, setNow] = useState(Date.now());
  const active = job.state === "running",
    done = job.state === "completed";
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
      "锁定上下文快照",
      `已保存的 ${job.messageCount} 条上下文消息；流式尾部及后续新增消息不纳入本次任务`,
    ],
    ["整理关键信息", "使用所选模型与 pi 原生压缩；不调用编码工具"],
    ["生成摘要预览", "仅保存快照结果，不自动替换当前会话上下文"],
  ];
  // Outside usage/child layout: the sheet keeps the design's full-viewport geometry.
  return createPortal(
    <dialog
      ref={ref}
      id={id}
      className="compression-page"
      data-od-id="background-compression-page"
      aria-labelledby={`${id}-heading`}
      aria-describedby={`${id}-note`}
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
          <p>当前会话 · 后台任务详情</p>
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
        <section>
          <div
            className="compression-status"
            data-state={job.state}
            role="status"
            aria-live="polite"
          >
            <CompressionIcon state={job.state} detail />
            <span>
              {active ? "压缩进行中" : `压缩${compressionLabels[job.state]}`}
            </span>
          </div>
          <p>
            {job.error ??
              (active
                ? "正在后台整理会话上下文，你可以返回会话继续操作。"
                : done
                  ? "快照压缩已完成，原始消息与当前会话上下文均未改变。"
                  : "任务已停止，原始消息与上下文均未改变。")}
          </p>
          {error && <p role="status">{error}</p>}
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
                {Math.max(
                  0,
                  ((job.endedAt ?? now) - job.startedAt) / 1000,
                ).toFixed(0)}
                s
              </dd>
            </div>
            <div>
              <dt>压缩前 · pi 估算</dt>
              <dd className="num">
                {job.before?.toLocaleString("zh-CN") ?? "—"} Token
              </dd>
            </div>
            <div>
              <dt>压缩后 · 快照估算</dt>
              <dd>
                {active
                  ? "等待结果"
                  : job.after == null
                    ? "—"
                    : `${job.after.toLocaleString("zh-CN")} Token`}
              </dd>
            </div>
          </dl>
        </section>
        <section>
          <h3>处理阶段</h3>
          <ol className="compression-steps">
            {steps.map(([heading, description], i) => {
              const current = job.phase === "snapshot" ? 0 : 1;
              const phase = done
                ? "done"
                : !active
                  ? "cancelled"
                  : i < current
                    ? "done"
                    : i === current
                      ? "current"
                      : "pending";
              return (
                <li key={heading} data-phase={phase}>
                  <span className="compression-step-number">
                    {phase === "done" ? "✓" : i + 1}
                  </span>
                  <div>
                    <strong>{heading}</strong>
                    <small>{description}</small>
                  </div>
                </li>
              );
            })}
          </ol>
        </section>
        <section>
          <div className="row-between">
            <h3>摘要预览</h3>
            <span className="meta">pi · 不自动应用</span>
          </div>
          <div className="card compression-preview">
            {done ? (
              <article>
                <h4>模型摘要 · {job.selection.id}</h4>
                <pre>{job.summary}</pre>
              </article>
            ) : (
              <p>
                {active
                  ? "摘要尚未生成，完成后将在这里展示预览。"
                  : "本次任务没有已确认的摘要。"}
              </p>
            )}
          </div>
        </section>
        <section>
          <h3>上下文保留</h3>
          <p style={{ marginTop: 8 }}>
            本次任务基于启动时已保存的上下文。新增消息不受影响；取消不会删除或覆盖原始内容。
          </p>
          <p id={`${id}-note`} style={{ marginTop: 8 }}>
            压缩仅作用于独立快照，不会降低当前会话的占用率。原会话仍由 pi
            管理自动压缩；本任务最多运行两分钟。
          </p>
          {job.usage && (
            <p style={{ marginTop: 8 }}>
              本次摘要用量：{job.usage.total.toLocaleString("zh-CN")} Token ·
              预计花费{" "}
              {job.usage.cost == null ? "—" : `US$${job.usage.cost.toFixed(4)}`}
              （不计入主／子会话统计）
            </p>
          )}
        </section>
      </div>
      <footer>
        <small>{active ? "返回会话不影响后台任务" : "原始上下文已保留"}</small>
        <button
          type="button"
          className="btn"
          disabled={busy || (!active && pending)}
          onClick={onAction}
        >
          {active ? "取消任务" : "重新压缩"}
        </button>
      </footer>
    </dialog>,
    document.body,
  );
}
