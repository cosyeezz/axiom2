import { useEffect, useRef } from "react";
import { Dialog } from "../components.js";
import type { Scope } from "../../shared/protocol.js";
import type { PreviewSelection } from "../../shared/preview.js";
import { usePreview, type View } from "./usePreview.js";
import { PreviewSetup } from "./PreviewSetup.js";
import "../styles/preview.css";
export function PreviewPanel({
  scope,
  onClose,
}: {
  scope: Scope;
  onClose: () => void;
}) {
  const state = usePreview(scope),
    { view, cleanup, busy, error, pending, target, note, draft, mutate } =
      state;
  const frame = useRef<HTMLIFrameElement>(null);
  useEffect(() => {
    const receive = (event: MessageEvent<PreviewSelection>) => {
      if (
        !view ||
        event.source !== frame.current?.contentWindow ||
        event.origin !== view.origin
      )
        return;
      const d = event.data,
        t = d?.target;
      if (
        d?.type !== "axiom-element" ||
        d.previewId !== view.id ||
        d.binding !== view.binding ||
        !t ||
        t.revision !== view.revision
      )
        return;
      if (
        typeof t.selector !== "string" ||
        typeof t.text !== "string" ||
        typeof t.tag !== "string" ||
        typeof t.snippet !== "string" ||
        t.selector.length > 2000 ||
        t.text.length > 1000 ||
        t.snippet.length > 4000
      )
        return;
      draft(t);
    };
    addEventListener("message", receive);
    return () => removeEventListener("message", receive);
  }, [view, note]);
  const disabled = busy || !!pending;
  return (
    <Dialog
      title="项目预览与元素评论"
      onClose={onClose}
      className="preview-dialog"
    >
      <div className="row">
        <span className="meta">
          关闭窗口不停止预览。项目页面不获得应用令牌；不代理外部网站。
        </span>
        <button className="btn" onClick={onClose}>
          返回工作台
        </button>
      </div>
      {cleanup.length > 0 && (
        <section role="alert">
          <p>预览进程清理待核实；不会自动续跑、按旧 PID 杀进程或回滚文件：</p>
          <pre>
            {cleanup.map((x) => `PID ${x.pid} · ${x.command}`).join("\n")}
          </pre>
          <button
            className="btn"
            disabled={disabled}
            onClick={async () => {
              if (
                confirm(
                  "我已检查并结束上列项目进程及其子进程。确认不会回滚文件。",
                )
              ) {
                await mutate("preview.cleanup.confirm", {
                  confirmed: true,
                  ids: cleanup.map((x) => x.id),
                });
                await state.load();
              }
            }}
          >
            确认预览已清理
          </button>
        </section>
      )}
      {!view ? (
        <PreviewSetup
          disabled={disabled}
          onError={state.setError}
          onOpen={async (params) => {
            const next = await mutate<View>("preview.open", params);
            if (next) state.setView(next);
          }}
        />
      ) : (
        <>
          <div className="row preview-actions">
            <button
              className="btn"
              disabled={disabled}
              onClick={() =>
                frame.current?.contentWindow?.postMessage(
                  {
                    type: "axiom-annotate",
                    previewId: view.id,
                    binding: view.binding,
                    enabled: true,
                  },
                  view.origin,
                )
              }
            >
              点选元素
            </button>
            <button
              className="btn"
              disabled={disabled}
              onClick={async () => {
                const next = await mutate<View>("preview.refresh");
                if (next) {
                  state.setView(next);
                  draft(null);
                  if (frame.current) frame.current.src = next.url;
                }
              }}
            >
              刷新预览
            </button>
            <button
              className="btn"
              disabled={disabled}
              onClick={async () => {
                if (await mutate("preview.close")) {
                  state.setView(null);
                  draft(null);
                  await state.load();
                }
              }}
            >
              停止预览
            </button>
            <span className="meta">
              项目热更新不代理，请显式刷新。CSP 禁止注入的页面不提供点选。
            </span>
          </div>
          <iframe
            ref={frame}
            src={view.url}
            title="隔离项目预览"
            sandbox="allow-scripts allow-same-origin"
            referrerPolicy="no-referrer"
          />
          {target && (
            <form
              className="annotation-card"
              onSubmit={async (e) => {
                e.preventDefault();
                if (
                  await mutate("annotation.send", {
                    binding: view.binding,
                    target,
                    note,
                  })
                ) {
                  state.setError("评论已发送到绑定会话。");
                }
              }}
            >
              <strong>元素评论 · {target.tag}</strong>
              <code>{target.selector}</code>
              <p>{target.text}</p>
              <label>
                修改备注
                <textarea
                  className="input"
                  required
                  maxLength={2000}
                  value={note}
                  onChange={(e) => draft(target, e.target.value)}
                />
              </label>
              <button
                className="btn"
                disabled={disabled || target.revision !== view.revision}
              >
                发送元素评论
              </button>
              <button type="button" className="btn" onClick={() => draft(null)}>
                取消点选
              </button>
              {target.revision !== view.revision && (
                <p role="alert">页面修订已变化，请重新选择元素；备注已保留。</p>
              )}
            </form>
          )}
        </>
      )}
      <div className="row">
        <button
          className="btn"
          disabled={busy}
          onClick={() => void state.load()}
        >
          重新读取预览
        </button>
        {pending && (
          <button
            className="btn"
            disabled={busy}
            onClick={() => void state.reconcile()}
          >
            核实预览操作（不重做）
          </button>
        )}
      </div>
      <p role="status">{error}</p>
    </Dialog>
  );
}
