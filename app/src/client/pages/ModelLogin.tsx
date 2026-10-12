import { useEffect, useRef, useState } from "react";
import { Dialog } from "../components.js";
import { command, useConnection, useScope } from "../transport.js";
import type { AuthState } from "../../shared/models.js";

export function ModelLogin({
  providerId,
  type,
  revision,
  close,
}: {
  providerId: string;
  type: "api_key" | "oauth";
  revision: string;
  close: () => void;
}) {
  const event = useScope<AuthState | null>("authentication", null),
    connection = useConnection();
  const [id, setId] = useState(""),
    [answer, setAnswer] = useState(""),
    [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [lostConnection, setLostConnection] = useState(false);
  useEffect(() => {
    if (connection !== "已连接本地服务") setLostConnection(true);
  }, [connection]);
  const active = useRef(true);
  const started = useRef<Promise<{ id: string }> | null>(null);
  const startRequest = useRef(crypto.randomUUID());
  const [closing, setClosing] = useState(false);
  const state = event?.id === id ? event : null;
  useEffect(() => {
    active.current = true;
    let flow = "";
    started.current = command<{ id: string }>(
      "auth.start",
      { providerId, type, revision },
      {},
      startRequest.current,
    );
    void started.current
      .then((result) => {
        flow = result.id;
        if (active.current) setId(flow);
        else void command("auth.cancel", { id: flow }).catch(() => {});
      })
      .catch((e) => {
        if (active.current) setError(e.message);
      });
    return () => {
      active.current = false;
      if (flow) void command("auth.cancel", { id: flow }).catch(() => {});
    };
  }, []);
  useEffect(() => {
    setAnswer("");
    setBusy(false);
  }, [state?.prompt?.id]);
  const disconnected = lostConnection || connection !== "已连接本地服务";
  const dismiss = async () => {
    if (closing) return;
    setClosing(true);
    try {
      if (!disconnected) {
        const flow = await started.current?.catch(async (error) => {
          if (error.code !== "UNCERTAIN") return null;
          const receipt = await command<{
            status: string;
            data?: { id?: string };
          }>("request.get", { requestId: startRequest.current });
          if (receipt.status === "committed" && receipt.data?.id)
            return { id: receipt.data.id };
          if (["not_found", "failed"].includes(receipt.status)) return null;
          throw Error("登录受理状态待核实；请稍后再次取消，不会重新登录。");
        });
        if (flow) await command("auth.cancel", { id: flow.id });
      }
      close();
    } catch (e) {
      setError((e as Error).message);
      if (disconnected) close();
    } finally {
      setClosing(false);
    }
  };
  return (
    <Dialog
      title={`${type === "oauth" ? "OAuth" : "API Key"} 登录 · ${providerId}`}
      onClose={() => void dismiss()}
      className="settings-dialog"
    >
      <p role="status">
        {error ||
          (disconnected
            ? "连接已断开；此登录流程不会自动重做，请关闭并重新读取认证状态。"
            : state?.message || "正在启动认证…")}
      </p>
      {state?.url && !disconnected && !closing && (
        <p>
          <a
            className="btn"
            href={state.url}
            target="_blank"
            rel="noopener noreferrer"
          >
            打开供应商授权页面
          </a>
        </p>
      )}
      {state?.userCode && !disconnected && !closing && (
        <p>
          设备验证码：<code>{state.userCode}</code>
        </p>
      )}
      {state?.prompt && !disconnected && !closing && (
        <form
          key={state.prompt.id}
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError("");
            try {
              await command("auth.answer", {
                id,
                promptId: state.prompt!.id,
                answer,
              });
              setAnswer("");
            } catch (error) {
              setError((error as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <label htmlFor="auth-answer">{state.prompt.message}</label>
          {state.prompt.type === "select" ? (
            <select
              className="input"
              id="auth-answer"
              value={answer}
              required
              onChange={(e) => setAnswer(e.target.value)}
            >
              <option value="">请选择</option>
              {state.prompt.options?.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          ) : (
            <input
              autoFocus
              className="input"
              id="auth-answer"
              autoComplete="off"
              type={state.prompt.type === "secret" ? "password" : "text"}
              value={answer}
              maxLength={8192}
              required
              onChange={(e) => setAnswer(e.target.value)}
            />
          )}
          <button className="btn" disabled={busy || !answer}>
            提交认证输入
          </button>
        </form>
      )}
      <div className="dialog-actions">
        <button
          className="btn btn-ghost"
          disabled={closing}
          onClick={() => void dismiss()}
        >
          {closing
            ? "正在结束认证…"
            : state?.status === "running" || !state
              ? "取消登录"
              : "关闭并刷新状态"}
        </button>
      </div>
      <p className="field-help">
        认证输入仅发给本地 pi，不写入浏览器存储；OAuth 交换和令牌保存由 pi
        负责。
      </p>
    </Dialog>
  );
}
