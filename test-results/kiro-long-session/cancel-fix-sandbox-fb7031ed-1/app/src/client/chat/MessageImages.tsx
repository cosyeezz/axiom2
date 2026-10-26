import { useEffect, useState } from "react";
import type { ChatMessage } from "../../shared/agent.js";
import type { ImageAttachment, Scope } from "../../shared/protocol.js";
import { command } from "../transport.js";
import { AttachmentSymbol } from "./AttachmentSymbol.js";
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
          <AttachmentSymbol kind="image" id={image.id} />
        </button>
      </li>)}
    </ul>
  </section>{visible && preview && <ImagePreview image={preview.image} loading={preview.loading} error={preview.error} onClose={() => setPreview(null)} />}</>;
}
