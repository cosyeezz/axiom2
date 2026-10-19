import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { ImageAttachment } from "../../shared/protocol.js";
import { Icon } from "../components.js";

/** Only scoped attachment bytes are displayed; never accept external image URLs. */
export function ImagePreview({ image, loading = false, error = "", onClose }: {
  image: Omit<ImageAttachment, "data"> & { data?: string };
  loading?: boolean; error?: string; onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null), close = useRef<HTMLButtonElement>(null);
  const heading = useId(), [failed, setFailed] = useState(false);
  const backdrop = useRef(false);
  useEffect(() => {
    const trigger = document.activeElement as HTMLElement | null;
    const node = dialog.current!;
    node.showModal();
    close.current?.focus();
    return () => {
      node.close();
      if (trigger?.isConnected) trigger.focus({ preventScroll: true });
    };
  }, []);
  const supported = ["image/png", "image/jpeg", "image/gif", "image/webp", "image/svg+xml"].includes(image.mimeType);
  const outside = (x: number, y: number) => {
    const box = dialog.current!.getBoundingClientRect();
    return x < box.left || x > box.right || y < box.top || y > box.bottom;
  };
  return createPortal(<dialog ref={dialog} className="image-preview" aria-labelledby={heading}
    onCancel={(e) => { e.preventDefault(); e.stopPropagation(); onClose(); }}
    onKeyDown={(e) => e.stopPropagation()}
    onPointerDown={(e) => { backdrop.current = e.target === e.currentTarget && outside(e.clientX, e.clientY); }}
    onClick={(e) => {
      if (backdrop.current && e.target === e.currentTarget && outside(e.clientX, e.clientY)) onClose();
      backdrop.current = false;
    }}>
    <header className="image-preview-header">
      <div><h2 id={heading}>图片预览 · {image.id}</h2><p data-tooltip={image.name}>{image.name}</p></div>
      <button ref={close} type="button" className="icon-btn" aria-label="关闭图片预览" onClick={onClose}><Icon name="close" /></button>
    </header>
    <div className="image-preview-body">
      {loading ? <p role="status">正在加载图片…</p> : error ? <p role="alert">{error}</p> : failed || !supported || !image.data ? <p role="status">图片无法预览，文件可能已损坏或格式不受支持。</p> :
        <img src={`data:${image.mimeType};base64,${image.data}`} alt={image.name} onError={() => setFailed(true)} />}
    </div>
  </dialog>, document.body);
}
