import { useState } from "react";
import {
  AppError,
  scopeKey,
  type Scope,
  type Session,
} from "../../shared/protocol.js";
import {
  agentScope,
  emptyAgent,
  threadScope,
  emptyThread,
} from "../../shared/agent.js";
import {
  compressionScope,
  compressionLabels,
  type Compression as Job,
} from "../../shared/compression.js";
import { command, useConnection, useScope } from "../transport.js";
import { CompressionDetail, CompressionIcon } from "./CompressionDetail.js";

export function Compression({ scope }: { scope?: Scope }) {
  const job = useScope<Job | null>(
    scope ? compressionScope(scope) : null,
    null,
  );
  const info = useScope(scope ? agentScope(scope) : null, emptyAgent);
  const thread = useScope(scope ? threadScope(scope) : null, emptyThread);
  const session = useScope<Session | null>(
    scope ? scopeKey(scope) : null,
    null,
  );
  const connection = useConnection();
  const [open, setOpen] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const key = scope ? `compression:${scopeKey(scope)}:pending` : "";
  const [pending, setPending] = useState<string | null>(() => {
    try {
      return sessionStorage.getItem(key);
    } catch {
      return null;
    }
  });
  const clearPending = () => {
    try {
      sessionStorage.removeItem(key);
      setPending(null);
    } catch {
      setError("操作已返回，但无法清除本地标识；保留以便核实。");
    }
  };
  const state = job?.state ?? "idle",
    active = state === "running";
  const id = `compression-${scope?.sessionId ?? "empty"}`;
  const run = async (op: "compression.start" | "compression.cancel") => {
    if (!scope || busy || (pending && op === "compression.start")) return;
    const requestId = crypto.randomUUID();
    try {
      // Persist intent before sending; uncertainty never causes a second model request.
      sessionStorage.setItem(key, requestId);
    } catch {
      setError("无法保存操作标识，未发送压缩请求。");
      return;
    }
    setPending(requestId);
    setBusy(true);
    setError("");
    try {
      await command(
        op,
        op === "compression.cancel" ? { id: job?.id } : {},
        scope,
        requestId,
      );
      clearPending();
    } catch (e) {
      setError((e as Error).message);
      if ((e as AppError).code !== "UNCERTAIN") clearPending();
    } finally {
      setBusy(false);
    }
  };
  const reconcile = async () => {
    if (!pending || !scope) return;
    setBusy(true);
    try {
      const receipt = await command<{
        status: string;
        data?: { message?: string };
      }>("request.get", { requestId: pending }, scope);
      if (
        ["committed", "failed", "not_found"].includes(receipt.status) ||
        job?.requestId === pending
      ) {
        setError(
          receipt.status === "failed"
            ? (receipt.data?.message ?? "操作失败")
            : "已核实；未重新发送压缩请求。",
        );
        clearPending();
      } else setError("操作仍待核实；不会自动重发。请稍后重新读取。");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <button
        type="button"
        className="compression-trigger"
        data-od-id="background-compression-trigger"
        data-state={state}
        aria-controls={id}
        aria-haspopup="dialog"
        aria-label={
          job
            ? `后台压缩${compressionLabels[job.state]}，查看详情`
            : "启动后台压缩"
        }
        title={
          job
            ? "查看当前会话的压缩任务详情"
            : "在后台压缩已保存上下文的快照；仅预览，不自动应用"
        }
        style={{
          width: 44,
          minWidth: 44,
          padding: 0,
          justifyContent: "center",
        }}
        disabled={
          !job &&
          (!scope ||
            !thread.ids.length ||
            !info.selection ||
            !!pending ||
            busy ||
            connection !== "已连接本地服务")
        }
        onClick={() => (job ? setOpen(true) : void run("compression.start"))}
      >
        <CompressionIcon state={state} />
        <span className="screen-reader" role="status" aria-live="polite">
          {job ? `${compressionLabels[job.state]} · 查看` : "后台压缩"}
        </span>
      </button>
      {error && (
        <span className="compression-feedback" role="status">
          {error}
        </span>
      )}
      {pending && (
        <button
          type="button"
          className="compression-trigger"
          disabled={busy || connection !== "已连接本地服务"}
          onClick={() => void reconcile()}
        >
          核实压缩状态（不重发）
        </button>
      )}
      {open && job && (
        <CompressionDetail
          id={id}
          job={job}
          title={session?.title ?? "当前会话"}
          busy={busy || connection !== "已连接本地服务"}
          error={error}
          pending={!!pending}
          onReconcile={() => void reconcile()}
          onClose={() => setOpen(false)}
          onAction={() =>
            void run(active ? "compression.cancel" : "compression.start")
          }
        />
      )}
    </>
  );
}
