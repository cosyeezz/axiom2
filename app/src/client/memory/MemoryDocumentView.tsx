import { useEffect, useMemo, useRef, useState } from "react";
import { LocalPath, PathActions } from "../LocalPath.js";
import { command } from "../transport.js";
import type { Scope } from "../../shared/protocol.js";
import { emptyMemoryDocument, memoryEditBudgetBytes, type MemoryDocument, type MemoryReason } from "../../shared/memory.js";
import { markdownLocalLinks } from "../../shared/markdown.js";
import { BubbleLoadingIcon } from "../StatusIcons.js";
import { Markdown } from "../chat/Markdown.js";
import { MemoryOrganizeControl } from "./MemoryOrganizeControl.js";

function referencePath(base: string, href: string) {
  let value = href.split("#")[0];
  try { value = decodeURIComponent(value); } catch { /* Literal names still get server validation. */ }
  if (/^(?:[A-Za-z]:[\\/]|\/)/.test(value)) return value;
  const parts = base.replaceAll("\\", "/").split("/").slice(0, -1);
  for (const part of value.replaceAll("\\", "/").split("/")) {
    if (part === ".." && parts.length && parts.at(-1) !== "..") parts.pop();
    else if (part && part !== ".") parts.push(part);
  }
  return parts.join("/");
}
const utf8Bytes = (content: string) => new TextEncoder().encode(content).byteLength;
function memoryReasonText(reason?: MemoryReason) {
  switch (reason) {
    case "missing": return "暂无记忆";
    case "unavailable": return "记忆暂不可用";
    case "correction_pending": return "记忆正在等待纠正完成";
    case "timeout": return "读取记忆超时";
    case "revision_conflict": return "资料已更新，请重新读取";
    case "read_failed": return "无法读取记忆";
    default: return "";
  }
}
const budgetMessage = "资料超过 180 KB UTF-8 编辑预算";
export function MemoryDocumentView({ scope, path, changed, navigate, dirtyChange, onReady }: { scope: Scope; path: string; changed: string; navigate: (path: string) => void; dirtyChange: (value: boolean) => void; onReady?: () => void }) {
  const [document, setDocument] = useState<MemoryDocument | null>(null), [draft, setDraft] = useState(""), [editing, setEditing] = useState(false);
  const [error, setError] = useState(""), [busy, setBusy] = useState(false), [refresh, setRefresh] = useState(0);
  const [activity, setActivity] = useState("正在读取资料…");
  const [comparison, setComparison] = useState<MemoryDocument | null>(null);
  const [opening, setOpening] = useState(false), [notice, setNotice] = useState("");
  const ready = useRef(onReady); ready.current = onReady;
  useEffect(() => { if (document) ready.current?.(); }, [!!document]);
  const openLocal = async () => {
    if (!document || opening) return;
    setOpening(true); setNotice(""); setError("");
    try { await command("memory.open", { path, revision: document.revision }, scope); if (mounted.current) setNotice("已提交本地打开请求"); }
    catch (e) { if (mounted.current) setError((e as Error).message); }
    finally { if (mounted.current) setOpening(false); }
  };
  const dirty = document !== null && draft !== document.content;
  const protectedRef = useRef(false); protectedRef.current = dirty || editing;
  const generation = useRef(0), latest = useRef(changed), mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { dirtyChange(dirty); return () => dirtyChange(false); }, [dirty]);
  useEffect(() => {
    if (protectedRef.current) return;
    const id = ++generation.current; setActivity("正在读取资料…"); setBusy(true); setError("");
    command<MemoryDocument>("memory.read", { path }, scope).then((value) => {
      if (generation.current !== id || protectedRef.current) return;
      setDocument(value); setDraft(value.content); latest.current = changed;
    }).catch(() => {
      if (generation.current === id && !protectedRef.current) { setDocument({ ...emptyMemoryDocument(path), reason: "unavailable" }); setDraft(""); }
    }).finally(() => { if (mounted.current && generation.current === id) setBusy(false); });
    return () => { generation.current++; };
  }, [path, scope.workspaceId, scope.sessionId, changed, refresh]);
  const readLatest = async () => {
    setActivity("正在读取最新版本…"); setBusy(true); setError("");
    try {
      let next = await command<MemoryDocument>("memory.read", { path }, scope);
      while (next.nextOffset !== null) {
        const page = await command<MemoryDocument>("memory.read", { path, offset: next.nextOffset }, scope);
        if (page.revision !== next.revision) throw Error("资料在读取期间变化，请重试");
        next = { ...page, offset: 0, content: next.content + page.content };
        if (utf8Bytes(next.content) > memoryEditBudgetBytes) throw Error(budgetMessage);
      }
      if (mounted.current) {
        if (next.available === false) setNotice("暂无记忆，当前草稿已保留。");
        else setComparison(next);
      }
    } catch (e) { if (mounted.current) setNotice(`${(e as Error).message || "暂无记忆"}，当前草稿已保留。`); }
    finally { if (mounted.current) setBusy(false); }
  };
  const loadMore = async () => {
    if (!document || document.nextOffset === null) return;
    const id = generation.current; setActivity("正在继续读取…"); setBusy(true);
    try {
      const next = await command<MemoryDocument>("memory.read", { path, offset: document.nextOffset }, scope);
      if (id !== generation.current || !mounted.current) return;
      if (next.revision !== document.revision) throw Error("资料已变化，请重新读取，不能拼接不同修订");
      const merged = { ...next, content: document.content + next.content, offset: 0 };
      if (utf8Bytes(merged.content) > memoryEditBudgetBytes) throw Error(budgetMessage);
      setDocument(merged); setDraft(merged.content);
    } catch (e) { if (mounted.current && id === generation.current) setError((e as Error).message || "无法继续读取资料"); } finally { if (mounted.current) setBusy(false); }
  };
  const save = async () => {
    if (!document) return;
    const submitted = draft; setActivity("正在保存记忆…"); setBusy(true); setError("");
    try {
      if (utf8Bytes(submitted) > memoryEditBudgetBytes) throw Error(budgetMessage);
      const next = await command<MemoryDocument>("memory.save", { path, revision: document.revision, content: submitted }, scope);
      if (!mounted.current) return;
      setDocument({ ...next, content: submitted, nextOffset: null }); setDraft(submitted); setEditing(false); setComparison(null); dirtyChange(false); setRefresh((n) => n + 1);
    } catch (e) { if (mounted.current) setError((e as Error).message); } finally { if (mounted.current) setBusy(false); }
  };
  const links = useMemo(() => markdownLocalLinks(document?.content ?? ""), [document?.content]);
  const displayedText = editing ? draft : document?.content ?? "";
  const characterCount = useMemo(() => [...displayedText].length.toLocaleString("zh-CN"), [displayedText]);
  const byteCount = useMemo(() => utf8Bytes(displayedText), [displayedText]);
  const overBudget = byteCount > memoryEditBudgetBytes;
  return <div className="memory-document">
    <div className="memory-doc-actions"><LocalPath path={path} scope={scope} base="memory" disabled={!document || document.available === false || busy} />
      {/\.(md|txt)$/i.test(path) && <button className="btn" disabled={!document || document.available === false || busy || opening} aria-busy={opening} onClick={() => void openLocal()} data-tooltip="打开磁盘上的文件；不保存当前草稿">{opening && <BubbleLoadingIcon />}{opening ? "正在打开…" : "打开本地文件"}</button>}
      <button className="btn" disabled={busy} onClick={() => { if (editing || dirty) void readLatest(); else setRefresh((n) => n + 1); }}>{editing || dirty ? "读取最新版本以合并" : "重新读取"}</button>
      {path === "MEMORY.md" && <MemoryOrganizeControl scope={scope} disabled={!document || document.available === false || busy || editing || dirty}
        disabledReason={editing || dirty ? "请先保存或取消编辑，再整理已保存的记忆" : undefined} />}
      {!editing && document?.available !== false && document?.nextOffset === null && (path === "MEMORY.md" || /^references\/.*\.(md|txt)$/i.test(path)) && <button className="btn" disabled={busy} onClick={() => { protectedRef.current = true; setEditing(true); }}>编辑</button>}
    </div>
    {notice && <p role="status">{notice}</p>}
    {!!links.length && <details className="memory-related memory-links"><summary>引用文件 <span>{links.length}</span></summary><nav aria-label="资料引用">{links.map((link, i) => <div className="memory-path-row" key={i}><button disabled={dirty} onClick={() => navigate(referencePath(path, link.href))}>{link.label}<span>{link.href}</span></button><PathActions path={referencePath(path, link.href)} scope={scope} base="memory" /></div>)}</nav></details>}
    {dirty && latest.current !== changed && <p role="status">来源已更新。当前编辑已保留；保存前需核对并合并新内容。</p>}
    {error && <p className="memory-error" role="alert">{error}</p>}
    {busy && <p className="memory-loading" role="status"><BubbleLoadingIcon />{activity}</p>}
    {comparison && <section><h3>最新版本 · 当前草稿保留在下方</h3><pre>{comparison.content}</pre><button className="btn" disabled={busy} onClick={() => { setDocument(comparison); setComparison(null); latest.current = changed; setError(""); }}>已核对，以此修订保存合并后的草稿</button></section>}
    {document?.available === false && <p className="memory-empty-copy">{memoryReasonText(document.reason) || "暂无记忆"}</p>}
    {document && document.available !== false && <>
      <p className="meta"><span data-tooltip="Unicode 字符数，含标点及空白">{document.image ? "图片资料" : `${editing ? "草稿 " : document.nextOffset !== null ? "已读取 " : ""}${characterCount} 字`}</span>{!document.image && <> · <span data-tooltip="UTF-8 字节数；编辑、合并和服务端保存共用 180 KB 上限">{byteCount.toLocaleString("zh-CN")} / {memoryEditBudgetBytes.toLocaleString("zh-CN")} bytes</span></>} · {new Date(document.updatedAt).toLocaleString()}</p>
      {document.reason && document.reason !== "missing" && <p className="meta" role="status">{memoryReasonText(document.reason)}</p>}
      {editing ? <><textarea aria-label="记忆内容" disabled={busy} value={draft} onChange={(e) => setDraft(e.target.value)} />{overBudget && <p className="memory-error" role="alert">{budgetMessage}；请删除或拆分内容后再保存。</p>}<div className="row"><button className="btn" disabled={busy || !dirty || !!comparison || overBudget} onClick={() => void save()}>保存</button><button className="btn" disabled={busy} onClick={() => { setDraft(document.content); setEditing(false); setComparison(null); setRefresh((n) => n + 1); }}>取消编辑</button></div></> : document.image ? <img className="memory-image" src={document.image} alt={path} /> : /\.(md|txt)$/i.test(path) ? <div className="markdown"><Markdown text={document.content} pathScope={scope} pathBase="memory" sourceFile={path} onLocalLink={(href) => { if (!dirty) navigate(referencePath(path, href)); }} /></div> : <pre>{document.content}</pre>}
      {document.nextOffset !== null && <button className="btn" disabled={busy} onClick={() => void loadMore()}>继续读取 · 内容尚未完整</button>}
    </>}
  </div>;
}
