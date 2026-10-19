export interface HtmlResource { href: string; kind: "style" | "script"; text: string }
interface ResourceTag { href: string; kind: HtmlResource["kind"]; start: number; end: number }

function attributeValue(value: string): string {
  const named: Record<string, string> = { amp: "&", AMP: "&", quot: '"', QUOT: '"', apos: "'", lt: "<", LT: "<", gt: ">", GT: ">", colon: ":", sol: "/", bsol: "\\", period: ".", Tab: "\t", NewLine: "\n" };
  return value.replace(/&(#x[\da-f]+;?|#\d+;?|[a-z]+;)/gi, (entity, key: string) => {
    if (!key.startsWith("#")) return named[key.slice(0, -1)] ?? entity;
    const code = key[1].toLowerCase() === "x" ? parseInt(key.slice(2), 16) : parseInt(key.slice(1), 10);
    return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : "\ufffd";
  });
}

/** Source ranges let the client replace only actual resource attributes, without
 * serializing the document or changing tag-like strings in scripts/text areas. */
export function htmlResourceTags(html: string): ResourceTag[] {
  const result: ResourceTag[] = [];
  const tags = /<!--[\s\S]*?(?:-->|$)|<![^>]*>|<\/?([a-z][a-z\d:-]*)\b((?:[^>"']|"[^"]*"|'[^']*')*)>/gi;
  let tag: RegExpExecArray | null, templates = 0;
  while ((tag = tags.exec(html))) {
    if (!tag[1]) continue;
    const name = tag[1].toLowerCase(), closing = tag[0].startsWith("</");
    if (name === "template") templates = Math.max(0, templates + (closing ? -1 : 1));
    if (closing) continue;
    if (name === "plaintext") break;
    if (/^(script|style|textarea|title|xmp|iframe|noembed|noframes|noscript)$/.test(name)) {
      const end = new RegExp(`</${name}(?=[\\s/>])[^>]*>`, "gi");
      end.lastIndex = tags.lastIndex;
      tags.lastIndex = end.exec(html) ? end.lastIndex : html.length;
    }
    if (templates || (name !== "link" && name !== "script")) continue;
    const attrs = new Map<string, { value: string; start: number; end: number }>();
    for (const attr of tag[2].matchAll(/([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)) {
      const key = attr[1].toLowerCase(), start = tag.index + 1 + tag[1].length + attr.index;
      if (!attrs.has(key)) attrs.set(key, { value: attributeValue(attr[2] ?? attr[3] ?? attr[4] ?? ""), start, end: start + attr[0].length });
    }
    const script = name === "script";
    if (!script && !attrs.get("rel")?.value.toLowerCase().split(/\s+/).includes("stylesheet")) continue;
    const attr = attrs.get(script ? "src" : "href");
    if (attr?.value) result.push({ href: attr.value, kind: script ? "script" : "style", start: attr.start, end: attr.end });
  }
  return result;
}

export function htmlResourceLinks(html: string): { href: string; kind: HtmlResource["kind"] }[] {
  const links = new Map<string, { href: string; kind: HtmlResource["kind"] }>();
  for (const { href, kind } of htmlResourceTags(html)) links.set(`${kind}:${href}`, { href, kind });
  return [...links.values()];
}
