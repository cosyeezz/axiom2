import { createContext, memo, useContext, useId, useMemo, useRef, type ReactNode } from "react";
import { LocalPath, isLocalPath } from "../LocalPath.js";
import { pathRelativeToFile } from "../../shared/local-paths.js";
import type { Scope } from "../../shared/protocol.js";
import { DerivedContext } from "./derived-cache.js";
import type { Token } from "marked";
import { FileLink } from "./FileLink.js";
import { localFileLink } from "../../shared/file-preview.js";
import { CodeBlock } from "./CodeBlock.js";
import { InlineCode } from "./InlineCode.js";
import { markdown, markdownTokens, markdownImagePath, type FootnoteDefinition } from "../../shared/markdown.js";
import { AttachmentReference, type AttachmentReferenceInfo } from "./AttachmentSymbol.js";
import { MarkdownImage, type MarkdownImageOwner } from "./MarkdownImage.js";
// Render token AST as React nodes, never untrusted HTML. Raw HTML stays literal.
type Note = FootnoteDefinition & { number: number };
type MarkdownPaths = { pathScope?: Scope; pathBase?: "workspace" | "memory"; sourceFile?: string; attachments?: AttachmentReferenceInfo[] };
const MarkdownContext = createContext<({ prefix: string; notes: Map<string, Note>; returns: Map<string, string>; onLocalLink?: (href: string) => void } & MarkdownPaths) | null>(null);
function AttachmentText({ text }: { text: string }) {
  const attachments = useContext(MarkdownContext)?.attachments;
  if (!attachments?.length) return <>{text}</>;
  const parts: ReactNode[] = [];
  let end = 0;
  for (const match of text.matchAll(/\[(file\d+|folder\d+|(?:img|imag)\d+)\]/g)) {
    const attachment = attachments.find(item => item.id === match[1]);
    if (!attachment) continue;
    parts.push(text.slice(end, match.index), <AttachmentReference key={match.index} {...attachment} />);
    end = match.index + match[0].length;
  }
  return <>{parts}{text.slice(end)}</>;
}
function focusNote(id?: string) {
  const target = id ? document.getElementById(id) : null;
  target?.scrollIntoView({ block: "nearest" });
  target?.focus({ preventScroll: true });
}
function FootnoteReference({ id, raw, compact }: { id: string; raw: string; compact: boolean }) {
  const context = useContext(MarkdownContext), referenceId = useId();
  const note = context?.notes.get(id);
  if (!context || !note) return <>{raw}</>;
  if (compact) return <sup>{note.number}</sup>;
  const target = `${context.prefix}-note-${note.number}`;
  return <sup><a id={referenceId} data-footnote-target={target} href={`#${target}`} aria-label={`查看引用 ${note.number}`} onClick={(event) => {
    event.preventDefault(); context.returns.set(id, referenceId); focusNote(target);
  }}>{note.number}</a></sup>;
}
function LocalMarkdownLink({ href, images, children }: { href: string; images?: MarkdownImageOwner; children: ReactNode }) {
  const context = useContext(MarkdownContext);
  const path = pathRelativeToFile(localFileLink(href)?.path ?? href.split("#")[0], context?.sourceFile);
  if (context?.onLocalLink) return <span className="local-path"><a href={href} onClick={(event) => { event.preventDefault(); context.onLocalLink!(href); }}>{children}</a></span>;
  if (images) return <FileLink href={href} owner={images}>{children}</FileLink>;
  return context?.pathScope ? <LocalPath path={path} scope={context.pathScope} base={context.pathBase} showActions={false}>{children}</LocalPath> : <span>{children}</span>;
}
function InlinePath({ path, images }: { path: string; images?: MarkdownImageOwner }) {
  const context = useContext(MarkdownContext);
  return <LocalPath path={pathRelativeToFile(path, context?.sourceFile)} scope={images?.scope ?? context?.pathScope} base={context?.pathBase} showActions={false}><code>{path}</code></LocalPath>;
}
type BlockRenderer = (children: ReactNode, index: number, source: string) => ReactNode;
function tokens(items: Token[], images?: MarkdownImageOwner, renderBlock?: BlockRenderer, compact = false, source?: { line: number; abandoned: boolean[] }): ReactNode {
  let line = source?.line ?? 0;
  return items.map((t: any, i) => {
    const startLine = line; line += (t.raw?.match(/\n/g) ?? []).length;
    const render = () => {
    const inner = () => (t.tokens ? tokens(t.tokens, images, undefined, compact || t.type === "link") : t.text);
    // The activity summary is a single-line disclosure control: no nested links,
    // copy buttons, checkboxes, or block layout inside its Markdown preview.
    if (compact) {
      if (["heading", "paragraph", "blockquote"].includes(t.type)) return <span key={i}>{inner()}{" "}</span>;
      if (t.type === "code") return <code key={i}>{t.text}{" "}</code>;
      if (t.type === "link") return <span key={i}>{inner()}</span>;
      if (t.type === "br" || t.type === "hr") return <span key={i}> </span>;
      if (t.type === "list") return <span key={i}>{t.items.map((item: any, n: number) => <span key={n}>{item.task ? (item.checked ? "☑ " : "☐ ") : t.ordered ? `${(t.start || 1) + n}. ` : "• "}{tokens(item.tokens, images, undefined, true)}{" "}</span>)}</span>;
      if (t.type === "table") return <span key={i}>{[t.header, ...t.rows].map((row: any[], n: number) => <span key={n}>{row.map((cell: any, j: number) => <span key={j}>{tokens(cell.tokens, images, undefined, true)}{" "}</span>)}</span>)}</span>;
    }
    switch (t.type) {
      case "text":
        return <span key={i}>{t.tokens ? inner() : <AttachmentText text={t.text ?? t.raw} />}</span>;
      case "space":
      case "footnote_definition":
        return null;
      case "footnote_reference":
        return <FootnoteReference key={i} id={t.id} raw={t.raw} compact={compact} />;
      case "heading": {
        const Tag = `h${Math.min(6, t.depth)}` as "h1";
        return <Tag key={i}>{inner()}</Tag>;
      }
      case "paragraph":
        return <p key={i}>{inner()}</p>;
      case "strong":
        return <strong key={i}>{inner()}</strong>;
      case "em":
        return <em key={i}>{inner()}</em>;
      case "del":
        return <del key={i}>{inner()}</del>;
      case "codespan":
        return compact ? <code key={i}>{t.text}</code> : isLocalPath(t.text)
          ? <InlinePath key={i} path={t.text} images={images} />
          : <InlineCode key={i} text={t.text} />;
      case "code":
        return <CodeBlock key={i} text={t.text} language={t.lang || ""} />;
      case "blockquote":
        return <blockquote key={i}>{inner()}</blockquote>;
      case "list": {
        const Tag = t.ordered ? "ol" : "ul";
        let itemLine = startLine;
        return (
          <Tag key={i} {...(t.ordered ? { start: t.start } : {})}>
            {t.items.map((item: any, n: number) => {
              const start = itemLine; itemLine += (item.raw?.match(/\n/g) ?? []).length;
              // Marked may omit the separator newline from the final line of an item.
              if (!item.raw?.endsWith("\n")) itemLine++;
              return <li key={n} data-abandoned={source?.abandoned[start] || undefined}>
                {item.task && (
                  <input
                    type="checkbox"
                    checked={item.checked}
                    readOnly
                    aria-label="任务状态"
                  />
                )}
                {tokens(item.tokens, images, undefined, false, source ? { ...source, line: start } : undefined)}
              </li>;
            })}
          </Tag>
        );
      }
      case "link": {
        // A linked picture opens our preview; do not nest a button inside a link.
        let linkedImage = false;
        if (images && t.tokens) markdown.walkTokens(t.tokens, (token) => {
          if (token.type === "image") linkedImage = true;
        });
        if (linkedImage) return <span key={i}>{inner()}</span>;
        if (localFileLink(t.href.split("#")[0])) return <LocalMarkdownLink key={i} href={t.href} images={images}>{inner()}</LocalMarkdownLink>;
        let safe = false;
        try {
          safe = /^(?:https?:\/\/|mailto:)/i.test(t.href) && ["http:", "https:", "mailto:"].includes(
            new URL(t.href).protocol,
          );
        } catch {}
        return safe ? (
          <a key={i} href={t.href} target="_blank" rel="noopener noreferrer">
            {inner()}
          </a>
        ) : (
          <span key={i}>{inner()}</span>
        );
      }
      case "image":
        return images && markdownImagePath(t.href) ?
          <MarkdownImage key={`${i}:${images.scope.workspaceId}:${images.scope.sessionId}:${images.messageId}:${t.href}`} href={t.href} alt={t.text} owner={images} /> :
          <span key={i}>[图片：{t.text}{images ? " · 仅支持本地绝对路径" : ""}]</span>;
      case "br":
        return <br key={i} />;
      case "hr":
        return <hr key={i} />;
      case "table":
        return (
          <div className="table-scroll" key={i}>
            <table>
              <thead>
                <tr>
                  {t.header.map((cell: any, j: number) => (
                    <th key={j}>{tokens(cell.tokens, images)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {t.rows.map((row: any[], j: number) => (
                  <tr key={j}>
                    {row.map((cell: any, k: number) => (
                      <td key={k}>{tokens(cell.tokens, images)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      default:
        return <span key={i}>{t.tokens ? inner() : (t.text ?? t.raw)}</span>;
    }
    };
    const rendered = render();
    const node = source?.abandoned[startLine] && rendered && t.type !== "list" ? <div key={i} data-abandoned>{rendered}</div> : rendered;
    return renderBlock && node && t.type !== "hr" ? renderBlock(node, i, t.raw) : node;
  });
}
export const Markdown = memo(({ text, images, renderBlock, compact = false, onLocalLink, pathScope, pathBase, sourceFile, attachments, abandonedLines }: { abandonedLines?: boolean[]; text: string; images?: MarkdownImageOwner; renderBlock?: BlockRenderer; compact?: boolean; onLocalLink?: (href: string) => void } & MarkdownPaths) => {
  const cache = useContext(DerivedContext), prefix = useId(), returns = useRef(new Map<string, string>());
  const ast = useMemo(() => cache ? cache.get(`markdown:footnotes-v2:breaks:${text}`, () => markdownTokens(text)) : markdownTokens(text), [cache, text]);
  const notes = useMemo(() => {
    const definitions = new Map<string, FootnoteDefinition>(), order = new Set<string>();
    markdown.walkTokens(ast, (token) => {
      if (token.type === "footnote_definition" && !definitions.has(token.id)) definitions.set(token.id, token as FootnoteDefinition);
      if (token.type === "footnote_reference") order.add(token.id);
    });
    const result = new Map<string, Note>();
    for (const id of [...order, ...definitions.keys()]) {
      const note = definitions.get(id);
      if (note && !result.has(id)) result.set(id, { ...note, number: result.size + 1 });
    }
    return result;
  }, [ast]);
  return <MarkdownContext.Provider value={{ prefix, notes, returns: returns.current, onLocalLink, pathScope, pathBase, sourceFile, attachments }}>
    {tokens(ast, images, renderBlock, compact, abandonedLines ? { line: 0, abandoned: abandonedLines } : undefined)}
    {!compact && notes.size > 0 && <section aria-label="引用"><hr /><ol>{[...notes.values()].map((note) => {
      const target = `${prefix}-note-${note.number}`;
      return <li key={note.id} id={target} tabIndex={-1}>{tokens(note.tokens, images)} <a href={`#${target}`} aria-label={`返回引用 ${note.number}`} onClick={(event) => {
        event.preventDefault(); focusNote(returns.current.get(note.id) ?? document.querySelector<HTMLAnchorElement>(`[data-footnote-target="${CSS.escape(target)}"]`)?.id);
      }}>↩</a></li>;
    })}</ol></section>}
  </MarkdownContext.Provider>;
});
