import { useRef, useState } from "react";
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
  type Selection,
} from "../../shared/agent.js";
import {
  compressionScope,
  compressionPreferencesScope,
  type CompressionPreferences,
  type Compression as Job,
} from "../../shared/compression.js";
import { command, useConnection, useScope } from "../transport.js";
import {
  CompressionDetail,
  CompressionIcon,
  compressionStatusLabel,
} from "./CompressionDetail.js";

export function Compression({ scope }: { scope?: Scope }) {
  const trigger = useRef<HTMLButtonElement>(null);
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
  const preferences = useScope<CompressionPreferences | null>(compressionPreferencesScope, null);
  const selection = preferences?.selection ?? info.selection;
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
  const state = job?.state ?? "idle";
  const startUnavailable = connection !== "已连接本地服务"
    ? "尚未连接本地服务，请连接后操作。"
    : !preferences ? "正在读取全局压缩模型设置…"
    : !thread.ids.length ? "此会话尚无消息可压缩。"
    : !selection ? "请先选择压缩模型。" : "";
  const saveModel = async (selection: Selection) => {
    setBusy(true);
    try {
      await command("compression.preferences.save", { selection });
      setError("");
    } finally { setBusy(false); }
  };
  const id = `compression-${scope?.sessionId ?? "empty"}`;
  const run = async (op: "compression.start" | "compression.cancel") => {
    if (!scope || busy || pending ||
      (op === "compression.start" && (job?.state === "running" || startUnavailable))) return;
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
        op === "compression.cancel" ? { id: job?.id } : { selection },
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
        ref={trigger}
        type="button"
        className="compression-trigger action-icon"
        data-od-id="background-compression-trigger"
        data-state={state}
        aria-controls={id}
        aria-haspopup="dialog"
        aria-expanded={open}
        popoverTarget={id}
        aria-label={job ? `打开后台压缩 · ${compressionStatusLabel(job)}` : "打开后台压缩"}
        data-tooltip="打开压缩页面：选择模型、开始压缩或取消任务"
        style={{
          width: 44,
          minWidth: 44,
          padding: 0,
          justifyContent: "center",
        }}
        disabled={!scope}
        onClick={(e) => { e.preventDefault(); setOpen((value) => !value); }}
      >
        <CompressionIcon state={state} />
        <span className="screen-reader" role="status" aria-live="polite">
          {job ? `${compressionStatusLabel(job)} · 查看` : "后台压缩"}
        </span>
      </button>
      {!open && error && (
        <span className="compression-feedback" role="status">
          {error}
        </span>
      )}
      {!open && pending && (
        <button
          type="button"
          className="compression-trigger"
          disabled={busy || connection !== "已连接本地服务"}
          onClick={() => void reconcile()}
        >
          核实压缩状态（不重发）
        </button>
      )}
      {open && (
        <CompressionDetail
          id={id}
          trigger={trigger.current!}
          job={job}
          title={session?.title ?? "当前会话"}
          selection={selection}
          contextWindow={info.usage?.context?.window}
          inherited={!preferences?.selection}
          onSelect={saveModel}
          startUnavailable={startUnavailable}
          busy={busy || connection !== "已连接本地服务"}
          error={error}
          pending={!!pending}
          onReconcile={() => void reconcile()}
          onClose={() => setOpen(false)}
          onStart={() => void run("compression.start")}
          onCancel={() => void run("compression.cancel")}
        />
      )}
    </>
  );
}
