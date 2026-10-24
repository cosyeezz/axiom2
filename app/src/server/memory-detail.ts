import { closeSync, existsSync, openSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { assertMemoryTitle, memoryBody } from "../shared/memory.js";
import { detailFile, detailIds, memoryOutline, parseDetailBlocks } from "../shared/memory-outline.js";
import { memoryPath, readMemoryTextSnapshot, replaceMemoryFile } from "./memory-files.js";
import { ensureMemoryDirectory } from "./memory-storage.js";

export interface DetailInput {
  action: "read" | "write"; id?: number; content?: string; revision?: string;
  oldText?: string; newText?: string; anchor?: string; entryRevision?: string;
}
function snapshot(entry: string) {
  const directory = dirname(entry), path = join(directory, detailFile);
  ensureMemoryDirectory(directory);
  if (!existsSync(path)) return { path, content: "<!-- detail-next:1 -->\n", revision: "", blocks: [] as ReturnType<typeof parseDetailBlocks> };
  const document = readMemoryTextSnapshot(memoryPath(directory, detailFile));
  return { path, ...document, blocks: parseDetailBlocks(document.content) };
}
export function assertMemoryEdit(entry: string, previous: string, next: string) {
  assertMemoryTitle(previous, next);
  const ids = detailIds(memoryBody(next));
  if (ids.length) {
    const document = snapshot(entry);
    if (ids.some(id => !document.blocks.some(block => block.id === id))) throw Error("记忆引用了不存在的详情，请先用memory_detail保存详情");
  }
}
/** Preflight normal write/edit tools without changing their matching semantics. */
export function guardMemoryEdit(entry: string, tool: string, input: Record<string, unknown>) {
  if (typeof input.path !== "string") return;
  const path = resolve(input.path);
  if (path === join(dirname(entry), detailFile)) throw Error("详情文件由memory_detail维护，请使用该工具更新单条详情");
  if (path !== resolve(entry)) return;
  const previous = readMemoryTextSnapshot(entry).content;
  if (tool === "write" && typeof input.content === "string") assertMemoryEdit(entry, previous, input.content);
  if (tool === "edit") {
    const edits = Array.isArray(input.edits) ? input.edits : [input];
    let next = previous;
    for (const edit of edits) {
      if (!edit || typeof edit.oldText !== "string" || typeof edit.newText !== "string") continue;
      // Ambiguous or fuzzy edits are left to the native tool, except title edits must be exact.
      if (!edit.oldText || previous.split(edit.oldText).length !== 2) throw Error("记忆编辑原文需唯一精确匹配，请重新读取");
      next = next.replace(edit.oldText, edit.newText);
    }
    assertMemoryEdit(entry, previous, next);
  }
}
export function memoryDetail(entry: string, input: DetailInput, signal?: AbortSignal) {
  signal?.throwIfAborted();
  if (input.id !== undefined && (!Number.isSafeInteger(input.id) || input.id < 1)) throw Error("详情编号无效");
  // Resolve only the host-supplied entry; no user-controlled session/path argument.
  memoryPath(dirname(entry), "MEMORY.md");
  const load = () => {
    const document = snapshot(entry), block = document.blocks.find(block => block.id === input.id);
    if (input.id !== undefined && !block) throw Error("详情不存在");
    return { document, block };
  };
  if (input.action === "read") {
    if (!input.id) throw Error("读取需要详情编号");
    const { document, block } = load();
    return { id: input.id, content: block!.content, revision: document.revision, entryRevision: readMemoryTextSnapshot(entry).revision };
  }
  if (input.action !== "write") throw Error("详情操作无效");
  const lock = join(dirname(entry), ".memory-detail.lock");
  let fd: number;
  try { fd = openSync(lock, "wx", 0o600); } catch { throw Error("详情正被其他写入占用；请稍后重试，若进程中断请先核对并清理锁文件"); }
  try {
    const { document, block } = load();
    if (block && (!input.revision || input.revision !== document.revision)) throw Error("详情修订冲突，请重新读取");
    const counter = [...document.content.matchAll(/^<!-- detail-next:([1-9]\d*) -->\r?$/gm)];
    const nextId = Number(counter[0]?.[1]);
    if (counter.length !== 1 || !Number.isSafeInteger(nextId) || nextId <= Math.max(0, ...document.blocks.map(block => block.id))) throw Error("详情编号计数损坏，未分配编号");
    const id = input.id ?? nextId;
    let content = input.content ?? (block && input.anchor !== undefined && input.oldText === undefined && input.newText === undefined ? block.content : undefined);
    if (input.oldText !== undefined || input.newText !== undefined) {
      if (!block || content !== undefined || !input.oldText || input.newText === undefined || block.content.split(input.oldText).length !== 2) throw Error("局部替换需要已有详情、唯一原文和新文，不能同时提交整块正文");
      content = block.content.replace(input.oldText, input.newText);
    }
    if (typeof content !== "string" || !content.trim() || Buffer.byteLength(content) > 120000 || /<!--\s*detail(?:-next)?:/.test(content)) throw Error("详情正文为空、超过120KB或包含受管标记");
    const main = readMemoryTextSnapshot(entry);
    let linked = main.content;
    if (input.anchor !== undefined) {
      if (!input.anchor || /[\r\n]/.test(input.anchor) || input.entryRevision !== main.revision) throw Error("主项定位或入口修订无效，请重新读取入口");
      const lines = main.content.split(/\r?\n/), positions = lines.flatMap((line, index) => line === input.anchor ? [index] : []);
      const outline = memoryOutline(memoryBody(main.content));
      if (positions.length !== 1 || !(outline.titleLine === positions[0] || outline.nodes.some(node => node.line === positions[0]))) throw Error("主项原文必须唯一匹配一个标题或事项");
      const suffix = detailIds(input.anchor).includes(id) ? "" : ` 〔${id}〕`;
      let line = 0;
      linked = main.content.replace(/[^\r\n]*(?:\r?\n|$)/g, value => line++ === positions[0] ? value.replace(/(?=\r?\n|$)/, suffix) : value);
    } else if (!block) throw Error("新建详情需要主项原文anchor及入口修订entryRevision");
    const newline = document.content.includes("\r\n") ? "\r\n" : "\n";
    const replacement = `<!-- detail:${id}:start -->${newline}${content}${newline}<!-- detail:${id}:end -->`;
    const updated = block ? document.content.slice(0, block.start) + replacement + document.content.slice(block.end)
      : document.content.replace(`<!-- detail-next:${nextId} -->`, `<!-- detail-next:${nextId + 1} -->`) + `${newline}${replacement}${newline}`;
    signal?.throwIfAborted();
    ensureMemoryDirectory(dirname(document.path));
    if (document.revision) replaceMemoryFile(document.path, document.revision, updated);
    else writeFileSync(document.path, updated, { flag: "wx", mode: 0o600 });
    if (linked !== main.content) {
      try { replaceMemoryFile(entry, main.revision, linked); }
      catch { throw Error(`详情${id}已保存但入口未关联；先read该编号获得revision及entryRevision，再提交编号、revision、anchor、entryRevision重试关联，勿重复新建`); }
    }
    return { id, content, revision: readMemoryTextSnapshot(document.path).revision, entryRevision: readMemoryTextSnapshot(entry).revision, linked: detailIds(memoryBody(linked)).includes(id) };
  } finally { closeSync(fd); unlinkSync(lock); }
}
