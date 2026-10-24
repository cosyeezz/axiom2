import { useMemo, useState } from "react";
import type { OfficePart } from "../../shared/file-preview.js";

type Block = { text: string } | { rows: string[][] };
type Page = { title: string; blocks: Block[] };
const elements = (node: Document | Element, name: string) => [...node.getElementsByTagNameNS("*", name)];
const first = (node: Document | Element, name: string) => elements(node, name)[0];
function documents(parts: OfficePart[]) {
  let nodes = 0;
  return new Map(parts.map(part => {
    if (/<!DOCTYPE|<!ENTITY/i.test(part.text)) throw Error("不允许 XML 实体声明");
    const xml = new DOMParser().parseFromString(part.text, "application/xml");
    if (xml.getElementsByTagName("parsererror").length) throw Error("文档 XML 无法解析");
    const stack: [Element, number][] = [[xml.documentElement, 0]];
    while (stack.length) {
      const [node, depth] = stack.pop()!;
      if (++nodes > 100000 || depth > 128) throw Error("文档结构过于复杂，超过阅读上限");
      for (const child of node.children) stack.push([child, depth + 1]);
    }
    return [part.name, xml] as const;
  }));
}
function readingPages(parts: OfficePart[]): Page[] {
  const docs = documents(parts);
  let used = 0;
  const bounded = (text: string) => { const value = text.slice(0, Math.max(0, 200000 - used)); used += value.length; return value; };
  const text = (node: Element) => bounded(elements(node, "t").map(t => t.textContent ?? "").join(""));
  const word = docs.get("word/document.xml");
  if (word) {
    const body = first(word, "body");
    if (!body) throw Error("缺少文档正文");
    const blocks: Block[] = [];
    for (const node of body.children) {
      if (blocks.length >= 2000 || used >= 200000) break;
      if (node.localName === "tbl") blocks.push({ rows: elements(node, "tr").slice(0, 200).map(row => [...row.children].filter(c => c.localName === "tc").slice(0, 50).map(text)) });
      else for (const p of node.localName === "p" ? [node] : elements(node, "p").slice(0, 2000 - blocks.length)) blocks.push({ text: text(p) });
    }
    return [{ title: "正文", blocks }];
  }
  const relation = (path: string, id: string, base: string) => {
    const rel = docs.get(path);
    const item = rel && elements(rel, "Relationship").find(node => node.getAttribute("Id") === id && node.getAttribute("TargetMode") !== "External");
    const target = item?.getAttribute("Target") ?? "";
    if (!target || /[\\:\x00-\x1f]/.test(target)) return undefined;
    const pathParts = (target.startsWith("/") ? target.slice(1) : base + target).split("/");
    const normalized: string[] = [];
    for (const p of pathParts) { if (p === "..") { if (!normalized.length) return undefined; normalized.pop(); } else if (p && p !== ".") normalized.push(p); }
    return docs.get(normalized.join("/"));
  };
  const id = (node: Element) => [...node.attributes].find(attr => attr.localName === "id" && !!attr.namespaceURI)?.value ?? "";
  const workbook = docs.get("xl/workbook.xml");
  if (workbook) {
    const shared = docs.get("xl/sharedStrings.xml");
    const strings = shared ? elements(shared, "si").map(node => elements(node, "t").map(t => t.textContent ?? "").join("")) : [];
    return elements(workbook, "sheet").slice(0, 100).map(sheet => {
      const xml = relation("xl/_rels/workbook.xml.rels", id(sheet), "xl/");
      const rows: string[][] = [];
      for (const row of xml ? elements(xml, "row").slice(0, 200) : []) {
        const values: string[] = [];
        for (const cell of [...row.children].filter(n => n.localName === "c").slice(0, 50)) {
          const column = (cell.getAttribute("r")?.match(/^[A-Z]+/)?.[0] ?? "");
          const index = column ? [...column].reduce((a, c) => a * 26 + c.charCodeAt(0) - 64, 0) - 1 : values.length;
          if (index >= 50 || index < 0) continue;
          const value = first(cell, "v")?.textContent ?? "";
          const type = cell.getAttribute("t");
          values[index] = bounded(type === "s" ? strings[Number(value)] ?? "" : type === "inlineStr" ? elements(cell, "t").map(n => n.textContent).join("") : value || (first(cell, "f") ? `=${first(cell, "f")!.textContent}（无缓存值）` : ""));
        }
        rows.push(Array.from({ length: values.length }, (_, i) => values[i] ?? ""));
      }
      return { title: sheet.getAttribute("name") ?? "工作表", blocks: rows.length ? [{ rows }] : [{ text: "空工作表或部件不可用" }] };
    });
  }
  const slides = docs.get("ppt/presentation.xml");
  if (slides) return elements(slides, "sldId").slice(0, 100).map((slide, index) => {
    const xml = relation("ppt/_rels/presentation.xml.rels", id(slide), "ppt/");
    return { title: `幻灯片 ${index + 1}`, blocks: xml ? elements(xml, "p").slice(0, 2000).map(p => ({ text: text(p) })) : [{ text: "幻灯片部件不可用" }] };
  });
  throw Error("未找到支持的 Office 文档结构");
}
export function OfficeFile({ parts }: { parts: OfficePart[] }) {
  const [selected, setSelected] = useState(0);
  const result = useMemo(() => { try { return { pages: readingPages(parts) }; } catch (error) { return { error: (error as Error).message }; } }, [parts]);
  if (result.error) return <div className="file-empty" role="alert"><strong>无法解析 Office 文档</strong><p>{result.error}</p></div>;
  const pages = result.pages ?? [], page = pages[Math.min(selected, Math.max(0, pages.length - 1))];
  return <div className="file-office"><p className="file-format-notice">内容阅读模式，不执行宏、公式或外链；不还原图片、图表与原版排版。最多100页／表、每表200行×50列、正文20万字符，超出部分不展示。</p>
    {pages.length > 1 && <label><span>页／工作表</span><select aria-label="Office 页或工作表" value={selected} onChange={e => setSelected(Number(e.target.value))}>{pages.map((page, i) => <option key={i} value={i}>{page.title}</option>)}</select></label>}
    <article>{page?.blocks.map((block, i) => "text" in block ? <p key={i}>{block.text || "\u00a0"}</p> : <div className="file-office-table" key={i}><table><tbody>{block.rows.map((row, r) => <tr key={r}>{row.map((cell, c) => <td key={c}>{cell}</td>)}</tr>)}</tbody></table></div>) ?? <p>没有可展示的内容</p>}</article>
  </div>;
}
