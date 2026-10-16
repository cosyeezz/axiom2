import { useEffect, useRef, useState } from "react";
import { Dialog } from "../components.js";
import { command, useConnection, useScope } from "../transport.js";
import type { AuthState } from "../../shared/models.js";

export function ModelLogin({
  providerId,
  type,
  revision,
  inline = false,
  onComplete,
  close,
}: {
  providerId: string;
  type: "api_key" | "oauth";
  revision: string;
  inline?: boolean;
  onComplete: () => void;
  close: () => void;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { if (inline) heading.current?.focus(); }, [inline]);
  const event = useScope<AuthState | null>("authentication", null),
    connection = useConnection();
  const [id, setId] = useState(""),
    [answer, setAnswer] = useState(""),
    [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [opening, setOpening] = useState(false);
  const [browserMessage, setBrowserMessage] = useState("");
  const opened = useRef(new Set<string>());
  const completed = useRef(false);
  const completion = useRef(onComplete);
  completion.current = onComplete;
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
  const openBrowser = async () => {
    setOpening(true);
    setError("");
    try {
      await command("auth.open", { id });
      if (active.current && !completed.current) setBrowserMessage("已请求系统浏览器打开登录页；完成授权后返回此处。");
    } catch (e) {
      if (active.current && !completed.current) setError((e as Error).message);
    } finally {
      if (active.current) setOpening(false);
    }
  };
  useEffect(() => {
    if (type !== "oauth" || !state?.url || state.status !== "running" || disconnected || closing) return;
    if (opened.current.has(state.url)) return;
    opened.current.add(state.url);
    void openBrowser();
  }, [state?.url, state?.status, disconnected, closing, id, type]);
  useEffect(() => {
    if (state?.status !== "completed" || completed.current) return;
    completed.current = true;
    setAnswer("");
    setError("");
    completion.current();
  }, [state?.status]);
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
  const authFailed = !!error || disconnected || state?.status === "failed";
  const canInteract = state?.status === "running" && !disconnected && !closing;
  const title = `${type === "oauth" ? "OAuth" : "API Key"} 登录 · ${providerId}`;
  const content = (
    <>
      <p role={authFailed ? "alert" : "status"} className={`auth-status${authFailed ? " auth-error" : ""}`} data-state={authFailed ? "failed" : state?.status || "starting"}>
        {error ||
          (disconnected
            ? "连接已断开；此登录流程不会自动重做，请关闭并重新读取认证状态。"
            : state?.message || "正在启动认证…")}
      </p>
      {state?.url && canInteract && (
        <div className="auth-browser-step">
          <label htmlFor="oauth-url">在系统浏览器完成授权</label>
          <input id="oauth-url" className="input" readOnly value={state.url}
            onFocus={(e) => e.currentTarget.select()} />
          <div className="dialog-actions">
            <button className="btn" type="button" disabled={opening} onClick={() => void openBrowser()}>
              {opening ? "正在打开浏览器…" : "打开浏览器登录"}
            </button>
            <button className="btn btn-ghost" type="button" onClick={() => {
              void navigator.clipboard.writeText(state.url!).catch(() =>
                setError("复制失败，请选中上方链接手动复制到浏览器。"));
            }}>复制授权链接</button>
          </div>
          <p className="field-help" role="status">{browserMessage || "正在准备浏览器登录…"}</p>
          <p className="field-help">完成浏览器授权后将自动回填；未完成时按下方提示手动提交。</p>
        </div>
      )}
      {state?.userCode && canInteract && (
        <p>
          设备验证码：<code>{state.userCode}</code>
        </p>
      )}
      {state?.prompt && canInteract && (
        <form
          className="auth-input-step"
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
              spellCheck={false}
              placeholder={state.prompt.placeholder || (state.prompt.type === "manual_code" ? "按提示粘贴授权码或完整回调地址" : undefined)}
              type={state.prompt.type === "secret" ? "password" : "text"}
              value={answer}
              maxLength={8192}
              required={state.prompt.type !== "text"}
              onChange={(e) => setAnswer(e.target.value)}
            />
          )}
          <button className="btn" disabled={busy || (state.prompt.type !== "text" && !answer)}>
            {state.prompt.type === "manual_code" ? "提交回填" : "提交认证输入"}
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
        认证信息仅提交至本地服务，由 pi 保存；浏览器不存储凭据。
      </p>
    </>
  );
  return inline ? (
    <section className="oauth-login-panel" aria-labelledby="oauth-login-title">
      <div className="detail-heading"><h2 ref={heading} tabIndex={-1} id="oauth-login-title">{title}</h2></div>
      <div className="oauth-login-content">{content}</div>
    </section>
  ) : (
    <Dialog title={title} onClose={() => void dismiss()} className="settings-dialog">{content}</Dialog>
  );
}
