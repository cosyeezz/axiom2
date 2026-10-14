import { lazy, Suspense, useEffect, useRef, useState } from "react";
import type { ImageAttachment, Scope } from "../../shared/protocol.js";
import { command } from "../transport.js";
const ImagePreview = lazy(() => import("./ImagePreview.js").then((module) => ({ default: module.ImagePreview })));

export type MarkdownImageOwner = { scope: Scope; messageId: string };

// Several visible pictures share the server's bounded file reader without flooding it.
let loading = 0;
const waiting: (() => void)[] = [];
function schedule(load: () => Promise<void>) {
  const start = () => {
    loading++;
    void load().finally(() => { loading--; waiting.shift()?.(); });
  };
  if (loading < 2) start(); else waiting.push(start);
}

/** Load local bytes only through a message-bound server check, near the viewport. */
export function MarkdownImage({ href, alt, owner }: {
  href: string; alt: string; owner: MarkdownImageOwner;
}) {
  const host = useRef<HTMLSpanElement>(null);
  const [visible, setVisible] = useState(false), [attempt, setAttempt] = useState(0);
  const [image, setImage] = useState<ImageAttachment | null>(null);
  const [error, setError] = useState(""), [open, setOpen] = useState(false);
  const { workspaceId, sessionId } = owner.scope;
  useEffect(() => {
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        setVisible(true); observer.disconnect();
      }
    }, { rootMargin: "200px" });
    observer.observe(host.current!);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!visible) return;
    let active = true;
    setError(""); setImage(null);
    schedule(async () => {
      if (!active) return;
      try {
        const value = await command<ImageAttachment>("files.markdownImage", { messageId: owner.messageId, href }, { workspaceId, sessionId });
        if (active) setImage(value);
      } catch (failure) {
        if (active) setError((failure as Error).message);
      }
    });
    return () => { active = false; };
  }, [visible, attempt, href, workspaceId, sessionId, owner.messageId]);
  return <span ref={host} className="markdown-image">
    {error ? <span className="markdown-image-error" role="status">
      图片无法显示：{alt || "图片"} · {error}
      <button type="button" onClick={() => setAttempt((value) => value + 1)}>重试加载图片</button>
    </span> : image ? <button type="button" className="markdown-image-open" aria-label={`放大图片：${alt || image.name}`}
      aria-haspopup="dialog" title="点击放大图片" onClick={() => setOpen(true)}>
      <img src={`data:${image.mimeType};base64,${image.data}`} alt={alt || image.name}
        onError={() => { setOpen(false); setError("文件可能已损坏或格式不受支持"); }} />
    </button> : <span className="markdown-image-loading" role="status">正在加载图片：{alt || "图片"}…</span>}
    {open && image && !error && <Suspense fallback={<span role="status">正在打开预览…</span>}><ImagePreview image={{ ...image, name: alt || image.name }} onClose={() => setOpen(false)} /></Suspense>}
  </span>;
}
