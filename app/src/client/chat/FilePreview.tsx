import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { LocalPath } from "../LocalPath.js";
import { command } from "../transport.js";
import { guardFileNavigation, registerFileEditor } from "../file-edit-guard.js";
import { localFileLink, type FilePreview, type FileSaveResult } from "../../shared/file-preview.js";
import { markdownSection } from "../../shared/markdown-section.js";
import type { OpenFileReference } from "./FileLink.js";
import { FileIcon, type FileIconName } from "./FileIcon.js";
import { Markdown } from "./Markdown.js";
import { CodeBlock } from "./CodeBlock.js";
import { HtmlFile } from "./HtmlFile.js";
import { ImageFile, type ImageZoomControls, type ImageZoomState } from "./ImageFile.js";
import { WebPreview } from "./WebPreview.js";
import { OfficeFile } from "./OfficeFile.js";
import { ArchiveFile, MediaFile } from "./RichFile.js";
import { Icon } from "../Icon.js";
import "../styles/file-preview.css";
type Mode = "source" | "split" | "reading";
const modes: [Mode, string][] = [["source", "Markdown 源码"], ["split", "源码与预览对比"], ["reading", "Markdown 阅读"]];
function Action({ icon, label, onClick, disabled, pressed }: { icon: FileIconName; label: string; onClick: () => void; disabled?: boolean; pressed?: boolean }) {
  return <button type="button" className="file-action" aria-label={label} data-tooltip={label} aria-pressed={pressed} disabled={disabled} onClick={onClick}><FileIcon name={icon} /></button>;
}
function Source({ file, wrap, startLine = 1 }: { file: FilePreview; wrap: boolean; startLine?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const lines = (file.text ?? "").split("\n").length;
  useEffect(() => {
    if (file.line && ref.current) ref.current.scrollTop = Math.max(0, Math.min(file.line - startLine, lines - 1)) * 24;
  }, [file, lines, startLine]);
  return <div className={`file-source-scroll${wrap ? " is-wrapped" : ""}`} ref={ref} tabIndex={0} aria-label="文件源码">
    <div className="file-source-lines" aria-hidden="true">{Array.from({ length: Math.min(lines, 30000) }, (_, i) => i + startLine).join("\n")}</div>
    <div className="file-source-code"><CodeBlock text={file.text ?? ""} language={file.language ?? (file.kind === "markdown" ? "markdown" : "text")} /></div>
  </div>;
}
function useMedia(file: FilePreview | null) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    if (!file?.data || !file.mimeType) { setUrl(""); return; }
    const bytes = Uint8Array.from(atob(file.data), char => char.charCodeAt(0));
    const next = URL.createObjectURL(new Blob([bytes], { type: file.mimeType }));
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [file]);
  return url;
}
const size = (bytes: number) => bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
export function FilePreviewPanel({ reference, onClose }: { reference: OpenFileReference; onClose: () => void }) {
  const [file, setFile] = useState<FilePreview | null>(null), [error, setError] = useState("");
  const [editing, setEditing] = useState(false), [draft, setDraft] = useState(""), [saving, setSaving] = useState(false);
  const [fullDocument, setFullDocument] = useState(!!reference.edit);
  const dirty = useRef(false);
  dirty.current = saving || editing && draft !== (file?.text ?? "").replace(/\r\n/g, "\n");
  const parameters = () => reference.skillId ? { skillId: reference.skillId } : { messageId: reference.messageId, href: reference.href };
  useEffect(() => {
    const unregister = registerFileEditor(() => dirty.current);
    const unload = (event: BeforeUnloadEvent) => { if (dirty.current) { event.preventDefault(); event.returnValue = ""; } };
    window.addEventListener("beforeunload", unload);
    return () => { unregister(); window.removeEventListener("beforeunload", unload); };
  }, []);
  const [attempt, setAttempt] = useState(0), [loading, setLoading] = useState(true);
  const [member, setMember] = useState<{ entry: string; archiveRevision: string } | null>(null);
  const [mode, setMode] = useState<Mode>("reading"), [ratio, setRatio] = useState(50), [wrap, setWrap] = useState(false);
  const html = file?.kind === "code" && /\.html?$/i.test(file.name);
  const rendered = file?.kind === "markdown" || html;
  const [visited, setVisited] = useState({ source: false, reading: false });
  useEffect(() => {
    if (file) setVisited((old) => ({ source: old.source || !rendered || mode !== "reading", reading: old.reading || mode !== "source" }));
  }, [file, mode, rendered]);
  const [revealing, setRevealing] = useState(false), [notice, setNotice] = useState("");
  const [maximized, setMaximized] = useState(false);
  const [zoom, setZoom] = useState<ImageZoomState>({ percent: null, atMin: false, atMax: false });
  const imageControls = useRef<ImageZoomControls>(null);
  const panel = useRef<HTMLElement>(null), panes = useRef<HTMLDivElement>(null), alive = useRef(true);
  const url = useMedia(file);
  useEffect(() => { alive.current = true; panel.current?.focus(); return () => { alive.current = false; }; }, []);
  useEffect(() => {
    let current = true;
    const controller = new AbortController();
    setLoading(true); setError(""); setNotice("");
    void command<FilePreview>("files.document", { ...parameters(), ...member }, reference.owner.scope, crypto.randomUUID(), controller.signal)
      .then(result => { if (current) { setFile(result); setDraft((result.text ?? "").replace(/\r\n/g, "\n")); setEditing(!!reference.edit && !!result.editable); if (result.line || reference.edit && result.editable) setMode("source"); } })
      .catch(e => { if (current) setError(e.message); })
      .finally(() => { if (current) setLoading(false); });
    return () => { current = false; controller.abort(); };
  }, [reference, attempt, member]);
  const reveal = async () => {
    setRevealing(true); setNotice("");
    try {
      await command("files.reveal", parameters(), reference.owner.scope);
      if (alive.current) setNotice("已打开所在文件夹");
    } catch (e) { if (alive.current) setNotice((e as Error).message); }
    finally { if (alive.current) setRevealing(false); }
  };
  const save = async () => {
    if (!file?.editable || !file.revision || saving) return;
    setSaving(true); setNotice("");
    try {
      const result = await command<FileSaveResult>("files.save", { ...parameters(), revision: file.revision, text: draft }, reference.owner.scope);
      if (alive.current) { setFile({ ...file, ...result, text: draft }); setEditing(false); setNotice(reference.skillId ? "已保存；重新加载会话后应用技能更新。" : "文件已保存"); }
    } catch (error) { if (alive.current) setNotice((error as Error).message); }
    finally { if (alive.current) setSaving(false); }
  };
  const reload = () => guardFileNavigation(() => { setEditing(false); setAttempt(n => n + 1); });
  const fragment = reference.href ? localFileLink(reference.href)?.fragment : undefined;
  const section = useMemo(() => file?.kind === "markdown" && fragment && !member ? markdownSection(file.text ?? "", fragment) : null, [file, fragment, member]);
  const sectionActive = !!section && !fullDocument && !editing;
  const sourceFile = file && sectionActive ? { ...file, text: section.text, line: undefined } : file;
  const displayFile = file && editing ? { ...file, text: draft } : file;
  const clamp = (value: number) => Math.max(20, Math.min(80, value));
  const move = (clientX: number) => { const box = panes.current?.getBoundingClientRect(); if (box?.width) setRatio(clamp((clientX - box.left) / box.width * 100)); };
  const title = file?.name ?? reference.href?.replace(/\\/g, "/").split("/").at(-1) ?? "技能文件";
  const isText = file && ["markdown", "code", "text"].includes(file.kind);
  const showSource = !rendered || mode !== "reading";
  const readable = (sectionActive ? section.text.length : file?.text?.length ?? 0) <= 200000;
  let body: ReactNode;
  if (loading) body = <div className="file-empty" role="status"><span className="file-loading" /><strong>正在读取文件</strong><p>内容将在这里展开</p></div>;
  else if (error) body = <div className="file-empty" role="alert"><FileIcon name="file" /><strong>暂时无法预览</strong><p>{error}</p><button type="button" className="btn" onClick={() => setAttempt(n => n + 1)}>重新加载</button></div>;
  else if (!file) body = null;
  else if (isText) body = <div ref={panes} className={`file-panes mode-${rendered ? mode : "source"}`} style={{ "--file-split": `${ratio}%` } as CSSProperties}>
    <section className="file-source-pane" hidden={!showSource} aria-label="源码视图">
      <div className="file-pane-label"><span>{editing ? "编辑源码" : "源码"}</span><span>{file.encoding}</span></div>{editing ?
        <textarea className="file-editor" aria-label="编辑文件内容" spellCheck={false} value={draft} disabled={saving} onChange={event => setDraft(event.target.value)} wrap={wrap ? "soft" : "off"} /> :
        (showSource || visited.source) && <Source key={sectionActive ? section.startLine : "full"} file={sourceFile!} wrap={wrap} startLine={sectionActive ? section.startLine : 1} />}
    </section>
    {rendered && <>
      <div className="file-divider" hidden={mode !== "split"} role="separator" aria-label="调整源码与预览宽度" aria-orientation="vertical" aria-valuemin={20} aria-valuemax={80} aria-valuenow={Math.round(ratio)} tabIndex={0}
        onDoubleClick={() => setRatio(50)}
        onKeyDown={event => {
          if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) { event.preventDefault(); setRatio(v => event.key === "Home" ? 20 : event.key === "End" ? 80 : clamp(v + (event.key === "ArrowLeft" ? -5 : 5))); }
        }}
        onPointerDown={event => { if (event.button !== 0) return; event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); move(event.clientX); }}
        onPointerMove={event => { if (event.currentTarget.hasPointerCapture(event.pointerId)) move(event.clientX); }}
        onPointerUp={event => { if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }}><span /></div>
      <section className="file-reading-pane" hidden={mode === "source"} aria-label="渲染预览">
        <div className="file-pane-label"><span>预览</span><span>{html ? "HTML · 隔离预览" : "MARKDOWN"}</span></div>
        {html ? (mode !== "source" || visited.reading) && <HtmlFile text={displayFile?.text ?? ""} name={file.name} resources={file.resources} /> : <div className="file-reading-scroll" key={sectionActive ? section.startLine : "full"} tabIndex={0}>
          {(mode !== "source" || visited.reading) && (readable ? <div className="markdown file-reading"><Markdown text={displayFile?.text ?? ""} blockRange={sectionActive ? section.blocks : undefined} pathScope={reference.owner.scope} sourceFile={displayFile?.path} /></div> : <div className="file-empty"><strong>长文档请使用源码视图</strong><p>超过 200,000 字符的 Markdown 暂不排版，避免影响会话输入。</p><button className="btn" onClick={() => setMode("source")}>查看完整源码</button></div>)}
        </div>}
      </section>
    </>}
  </div>;
  else if (file.kind === "office") body = <OfficeFile key={file.name} parts={file.officeParts ?? []} />;
  else if (file.kind === "archive") body = <ArchiveFile entries={file.entries ?? []} onOpen={entry => { setMember({ entry, archiveRevision: file.revision! }); setMode("reading"); }} />;
  else if (file.kind === "audio" || file.kind === "video") body = <MediaFile url={url} kind={file.kind} name={file.name} />;
  else if (file.kind === "image") body = <ImageFile url={url} name={file.name} controls={imageControls} onZoomChange={setZoom} />;
  else if (file.kind === "pdf") body = <div className="file-pdf"><p>PDF 阅读器不可用时，可通过右上角打开所在文件夹。</p>{url && <object data={url} type="application/pdf" aria-label={`PDF 预览：${file.name}`}><div className="file-empty"><strong>此环境无法内嵌显示 PDF</strong><p>请打开所在文件夹，使用本地 PDF 阅读器查看。</p></div></object>}</div>;
  else body = <div className="file-empty"><FileIcon name="file" /><strong>{file.name}</strong><p>{file.reason}</p><button type="button" className="btn" disabled={revealing} onClick={() => void reveal()}><FileIcon name="folder" />打开所在文件夹</button></div>;
  if (!loading && !error && file && !member && !reference.skillId && !editing && (html || file.directory || file.name === "package.json")) body = <WebPreview key={`${file.path}:${attempt}:${file.revision ?? file.modified}`} reference={reference}>{body}</WebPreview>;
  return <aside className={`file-preview-panel${maximized ? " is-maximized" : ""}`} ref={panel} role="dialog" aria-modal="false" aria-label={`文件预览：${title}`} tabIndex={-1}
    onKeyDown={event => {
      if (editing && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") { event.preventDefault(); event.stopPropagation(); void save(); }
      if (event.key === "Escape" && !event.defaultPrevented) { event.preventDefault(); event.stopPropagation(); if (maximized) setMaximized(false); else onClose(); }
    }}>
    <header className="file-preview-header">
      <div className="file-title"><span className="file-type-icon"><FileIcon name={file?.kind === "image" ? "image" : "text"} /></span><div><strong data-tooltip={title}>{title}</strong><LocalPath className="file-path" path={file?.path ?? reference.href ?? ""} disabled={!file || loading || !!error || revealing} copyLabel="复制文件路径" onOpen={reveal} /></div></div>
      <div className="file-header-actions">
        <Action icon={maximized ? "restore" : "maximize"} label={maximized ? "还原文件预览" : "最大化文件预览"} pressed={maximized} onClick={() => setMaximized(value => !value)} />
        <Action icon="close" label="关闭文件预览" onClick={onClose} />
      </div>
    </header>
    <div className="file-preview-toolbar">
      {member && <button type="button" className="file-edit-action" onClick={() => setMember(null)}>返回压缩包</button>}
      <div className="file-mode-group" role="group" aria-label="预览模式">
        {rendered ? modes.map(([value, label]) => <Action key={value} icon={value} label={html ? label.replace("Markdown 源码", "HTML 源码").replace("Markdown 阅读", "HTML 预览") : label} pressed={mode === value} onClick={() => setMode(value)} disabled={loading} />) : <span className="file-format-label">{file ? ({ code: "代码", text: "纯文本", image: "图片", pdf: "PDF 文档", audio: "音频", video: "视频", archive: "压缩包", office: "办公文档", unsupported: "文件信息", markdown: "Markdown" })[file.kind] : "文件预览"}</span>}
      </div>
      <span className="file-mode-caption">{editing ? dirty.current ? "尚未保存" : "编辑中" : rendered ? mode === "split" ? "源码 · 预览" : mode === "source" ? "源码" : html ? "页面" : "阅读" : "预览"}</span>
      <div className="file-view-actions">
        {file?.editable && !loading && !error && (editing ? <>
          <button type="button" className="file-edit-action" disabled={saving} onClick={() => guardFileNavigation(() => { setEditing(false); setDraft((file.text ?? "").replace(/\r\n/g, "\n")); setNotice(""); })}>取消编辑</button>
          <button type="button" className="file-edit-action" disabled={saving} onClick={() => void save()}>{saving ? "保存中…" : "保存"}</button>
        </> : <button type="button" className="file-edit-action" onClick={() => { setFullDocument(true); setEditing(true); setMode("source"); setNotice(""); }}><Icon name="square-pen" />{sectionActive ? "编辑全文" : "编辑"}</button>)}
        {isText && showSource && <Action icon="wrap" label="自动换行" pressed={wrap} onClick={() => setWrap(v => !v)} />}
        {file?.kind === "image" && <><Action icon="minus" label="缩小图片" onClick={() => imageControls.current?.step(-1)} disabled={loading || zoom.atMin} /><span className="file-zoom">{zoom.percent === null ? "适应" : `${Math.round(zoom.percent)}%`}</span><Action icon="plus" label="放大图片" onClick={() => imageControls.current?.step(1)} disabled={loading || zoom.atMax} /><Action icon="fit" label="图片适应窗口" onClick={() => imageControls.current?.fit()} /></>}
        <Action icon="reload" label="重新加载文件" disabled={loading || saving} onClick={reload} />
      </div>
    </div>
    {!loading && !error && file?.kind === "markdown" && fragment && !member && <div className="file-section-bar" aria-label="章节预览">
      <span role="status">{section ? <>{sectionActive ? "章节" : "全文"} · <strong>{section.title}</strong>{sectionActive && <small>第 {section.startLine}–{section.endLine} 行</small>}</> : <>未找到章节 #{fragment}，已显示全文。</>}</span>
      {section && !editing && <button type="button" className="file-edit-action" onClick={() => setFullDocument(value => !value)}>{sectionActive ? "返回全文" : "查看链接章节"}</button>}
    </div>}
    {editing && notice && <p className="file-editor-notice" role="status">{notice}</p>}
    <div className="file-preview-body" aria-busy={loading}>{body}</div>
    <footer className="file-preview-footer"><span>{file ? `${size(file.size)}${file.text !== undefined ? ` · ${file.text.split("\n").length.toLocaleString()} 行` : ""}` : "本地文件"}</span><span className="file-notice" role="status" data-tooltip={notice || file?.resourceNotice}>{notice || file?.editReason || file?.resourceNotice || (html ? "默认允许脚本与联网 · 模块与项目可单独确认运行" : file?.encoding ?? "只读预览")}</span></footer>
  </aside>;
}
