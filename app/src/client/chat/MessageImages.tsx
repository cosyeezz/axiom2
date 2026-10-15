import { useEffect, useState } from "react";
import type { ChatMessage } from "../../shared/agent.js";
import type { ImageAttachment, Scope } from "../../shared/protocol.js";
import { command } from "../transport.js";
import { ImagePreview } from "./ImagePreview.js";

type Image = NonNullable<ChatMessage["images"]>[number];

/** Only metadata is subscribed; image bytes are requested when the icon is opened. */
export function MessageImages({ images, scope, messageId }: {
  images: ChatMessage["images"]; scope: Scope; messageId: string;
}) {
  const owner = `${scope.workspaceId}:${scope.sessionId}:${messageId}`;
  const [preview, setPreview] = useState<{
    owner: string; source: Image; image: Omit<ImageAttachment, "data"> & { data?: string };
    loading: boolean; error: string;
  } | null>(null);
  const visible = preview?.owner === owner && images?.some((image) =>
    image.id === preview.source.id && image.path === preview.source.path);
  useEffect(() => { if (preview && !visible) setPreview(null); }, [preview, visible]);
  function open(source: Image) {
    const captured = { owner, source, image: source, loading: true, error: "" };
    setPreview(captured);
    void command<ImageAttachment>(source.path ? "files.preview" : "message.image", source.path
      ? { path: source.path, id: source.id }
      : { messageId, imageId: source.id }, scope).then(
      (image) => setPreview((current) => current === captured ? { ...captured, image, loading: false } : current),
      (error: Error) => setPreview((current) => current === captured ? { ...captured, loading: false, error: error.message } : current),
    );
  }
  if (!images?.length) return null;
  return <><section className="message-images" aria-label="图片附件">
    <ul className="message-image-list">
      {images.map((image) => <li key={image.id}>
        <button type="button" className="message-image-icon" data-tooltip={`${image.id} · ${image.name}`}
          aria-label={`预览图片：${image.id} · ${image.name}`} aria-haspopup="dialog" onClick={() => open(image)}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="4" /><circle cx="8" cy="8" r="1" /><path d="m3 17 6-6 4 4 3-3 5 5" /></svg>
          <span className="message-image-label" aria-hidden="true">{image.id}</span>
        </button>
      </li>)}
    </ul>
  </section>{visible && preview && <ImagePreview image={preview.image} loading={preview.loading} error={preview.error} onClose={() => setPreview(null)} />}</>;
}
