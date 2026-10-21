import { useEffect, useRef, useState, type RefObject } from "react";
import { flushSync } from "react-dom";
import { Icon } from "../components.js";
import { DeleteIcon } from "../DeleteIcon.js";
import { getDraft, updateDraft } from "../drafts.js";
import { command } from "../transport.js";
import { attachmentLimits, type Attachment, type Draft, type ImageAttachment, type Scope } from "../../shared/protocol.js";
import { insertImageReferences, removeImageReferences } from "./image-placeholders.js";
import { assignReferences, removeAttachmentReferences } from "./attachment-placeholders.js";
import { ImagePreview } from "./ImagePreview.js";
import { AttachmentSymbol } from "./AttachmentSymbol.js";
import { openFileDialog } from "../OpenFileDialog.js";

function base64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1]);
    reader.onerror = () => reject(Error(`无法读取 ${file.name}`));
    reader.readAsDataURL(file);
  });
}

export function AttachmentPicker({ scope, nested, input, onBusy, onError }: {
  scope: Scope; nested: boolean; input: RefObject<HTMLTextAreaElement | null>;
  onBusy: (busy: boolean) => void; onError: (error: string) => void;
}) {
  const [reading, setReading] = useState(false), [selecting, setSelecting] = useState(false);
  const inFlight = useRef(false), mounted = useRef(true), request = useRef<AbortController | null>(null);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; request.current?.abort(); };
  }, []);
  function start() {
    if (inFlight.current) return false;
    inFlight.current = true; setReading(true); onBusy(true); onError("");
    return true;
  }
  function finish() {
    inFlight.current = false;
    if (mounted.current) { setReading(false); onBusy(false); }
  }
  function checkCount(owner: Scope, count: number) {
    const draft = getDraft(owner);
    if (count + (draft.attachments?.length ?? 0) + (draft.attachment ? 1 : 0) + (draft.images?.length ?? 0) > attachmentLimits.count)
      throw Error("每份草稿最多选择 50 个附件。");
  }
  async function select() {
    if (!start()) return;
    const owner = { ...scope }, original = getDraft(owner), node = input.current;
    const startAt = node?.selectionStart ?? original.text.length, endAt = node?.selectionEnd ?? original.text.length;
    const controller = new AbortController(); request.current = controller;
    setSelecting(true);
    try {
      const items = await openFileDialog({ purpose: "attachment", kind: "mixed", multiple: true, scope: owner }, controller.signal);
      if (!items.length) return;
      checkCount(owner, items.length);
      const current = getDraft(owner);
      const added = assignReferences(current.text, [...(current.attachments ?? []), ...(current.images ?? [])], items);
      // If typing continued while the native dialog was open, append rather than replacing a stale selection.
      const unchanged = current.text === original.text;
      const insertion = insertImageReferences(current.text, unchanged ? startAt : current.text.length,
        unchanged ? endAt : current.text.length, added.map((a) => a.id!));
      if (insertion.text.length > 12000) throw Error("附件占位符加入后消息超过 12000 字符，请缩短正文。");
      flushSync(() => updateDraft(owner, { text: insertion.text, attachments: [...(current.attachments ?? []), ...added] }));
      if (mounted.current && node === input.current) { node?.focus(); node?.setSelectionRange(insertion.cursor, insertion.cursor); }
    } catch (error) {
      if (mounted.current) onError(controller.signal.aborted
        ? controller.signal.reason instanceof Error && controller.signal.reason.name !== "AbortError" ? controller.signal.reason.message : "已取消附件选择。"
        : (error as Error).message);
    } finally {
      request.current = null;
      if (mounted.current) setSelecting(false);
      finish();
    }
  }
  // Clipboard images have no filesystem path: save a scoped copy, then reference its path too.
  async function paste(selected: File[]) {
    if (!start()) return;
    const owner = { ...scope }, original = getDraft(owner), node = input.current;
    let reserved: Attachment[] = [], insertion: ReturnType<typeof insertImageReferences> | undefined;
    try {
      checkCount(owner, selected.length);
      if (selected.some((file) => file.size > attachmentLimits.uploadBytes)) throw Error("粘贴图片每张最多 10 MiB。");
      reserved = assignReferences(original.text, [...(original.attachments ?? []), ...(original.images ?? [])], selected.map((file) => ({ name: file.name, path: "", kind: "image" })));
      insertion = insertImageReferences(original.text, node?.selectionStart ?? original.text.length,
        node?.selectionEnd ?? original.text.length, reserved.map((a) => a.id!));
      if (insertion.text.length > 12000) throw Error("附件占位符加入后消息超过 12000 字符，请缩短正文。");
      flushSync(() => updateDraft(owner, { text: insertion!.text }));
      node?.focus(); node?.setSelectionRange(insertion.cursor, insertion.cursor);
      const added: Attachment[] = [];
      for (let i = 0; i < selected.length; i++) {
        const file = selected[i];
        const uploaded = await command<Attachment>("files.upload", { name: file.name, data: await base64(file), id: reserved[i].id, kind: "image" }, owner);
        added.push(uploaded);
      }
      checkCount(owner, added.length);
      const current = getDraft(owner);
      updateDraft(owner, { attachments: [...(current.attachments ?? []), ...added] });
    } catch (error) {
      if (insertion) {
        const latest = getDraft(owner);
        updateDraft(owner, { text: latest.text === insertion.text ? original.text : removeAttachmentReferences(latest.text, reserved.map((a) => a.id!)) });
      }
      if (mounted.current) onError(`${(error as Error).message} 本次选择未加入草稿。`);
    } finally { finish(); }
  }
  useEffect(() => {
    const node = input.current;
    if (!node) return;
    const handler = (event: ClipboardEvent) => {
      const selected = Array.from(event.clipboardData?.items ?? []).filter((item) => item.kind === "file" && item.type.startsWith("image/"))
        .map((item) => item.getAsFile()).filter((file): file is File => !!file);
      if (!selected.length) return;
      event.preventDefault();
      if (inFlight.current) { onError("正在选择或读取附件，请稍后再粘贴图片。"); return; }
      void paste(selected);
    };
    node.addEventListener("paste", handler);
    return () => node.removeEventListener("paste", handler);
  });
  return <div className="attachment-picker">
    <button type="button" className="icon-btn attach-button" id={nested ? undefined : "attach"}
      aria-label={selecting ? "取消选择" : "添加附件"}
      data-tooltip={selecting ? "取消文件选择" : "选择文件、图片或文件夹（支持多选）"}
      aria-busy={selecting} disabled={reading && !selecting}
      onClick={() => selecting ? request.current?.abort() : void select()}>
      <Icon name={selecting ? "close" : "plus"} />
    </button>
  </div>;
}

export function AttachmentList({ scope, draft, reading }: { scope: Scope; draft: Draft; reading: boolean }) {
  const [preview, setPreview] = useState<{
    owner: string; source: Attachment | ImageAttachment;
    image: Omit<ImageAttachment, "data"> & { data?: string }; loading: boolean; error: string;
  } | null>(null);
  const owner = `${scope.workspaceId}:${scope.sessionId}`;
  const visible = preview?.owner === owner &&
    [...(draft.attachments ?? []), ...(draft.images ?? [])].some((item) => item === preview.source);
  useEffect(() => { if (preview && !visible) setPreview(null); }, [preview, visible]);
  function openPreview(source: Attachment | ImageAttachment) {
    const inline = "data" in source;
    const captured = { owner, source, image: inline ? source : {
      id: source.id ?? "img1", name: source.name, mimeType: "",
    }, loading: !inline, error: "" };
    setPreview(captured);
    if (!inline) void command<ImageAttachment>("files.preview", { path: source.path, id: source.id }, scope).then(
      (image) => setPreview((current) => current === captured ? { ...captured, image, loading: false } : current),
      (error: Error) => setPreview((current) => current === captured ? { ...captured, loading: false, error: error.message } : current),
    );
  }
  return <><div className="attachment" aria-label="待发送附件">
    {draft.attachment && <span className="attachment-chip" data-tooltip={draft.attachment.name}><AttachmentSymbol kind="file" /><span>{draft.attachment.name}</span><button type="button" className="icon-btn" aria-label={`移除附件：${draft.attachment.name}`} onClick={() => updateDraft(scope, { attachment: null })}><DeleteIcon /></button></span>}
    {draft.attachments?.map((a, index) => <span className="attachment-chip" key={a.id ?? `${index}-${a.name}`} data-tooltip={a.path ?? a.name}>
      {a.kind === "image" ? <button type="button" className="image-label attachment-label" data-tooltip={`${a.id ?? ""} · ${a.name}`} aria-label={`预览图片：${a.id ?? a.name}`} aria-haspopup="dialog" onClick={() => openPreview(a)}><AttachmentSymbol kind="image" id={a.id} /><span className="attachment-name">{a.name}</span></button> :
        <span className="attachment-label" aria-label={`${a.kind === "folder" ? "文件夹" : "文件"} ${a.id?.match(/\d+$/)?.[0] ?? ""}：${a.name}`}><AttachmentSymbol kind={a.kind} id={a.id} /><span className="attachment-name">{a.name}</span></span>}<button type="button" className="icon-btn" aria-label={`移除附件：${a.name}`} onClick={() => {
        const current = getDraft(scope);
        updateDraft(scope, { attachments: current.attachments?.filter((item) => item !== a),
          text: a.id ? removeAttachmentReferences(current.text, [a.id]) : current.text });
      }}><DeleteIcon /></button>
    </span>)}
    {draft.images?.map((image) => <span className="attachment-chip" key={image.id} data-tooltip={image.name}><button type="button" className="image-label attachment-label" aria-label={`预览图片：${image.id}`} aria-haspopup="dialog" onClick={() => openPreview(image)}><AttachmentSymbol kind="image" id={image.id} /><span className="attachment-name">{image.name}</span></button><button type="button" className="icon-btn" aria-label={`移除图片：${image.name}`} onClick={() => {
      const current = getDraft(scope);
      updateDraft(scope, { images: current.images?.filter((i) => i.id !== image.id), text: removeImageReferences(current.text, [image.id]) });
    }}><DeleteIcon /></button></span>)}
    {reading && <span className="attachment-loading" role="status">正在选择或读取附件…</span>}
  </div>{visible && preview && <ImagePreview image={preview.image} loading={preview.loading} error={preview.error} onClose={() => setPreview(null)} />}</>;
}
