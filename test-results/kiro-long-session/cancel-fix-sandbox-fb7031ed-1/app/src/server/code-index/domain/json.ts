import { createHash } from "node:crypto";
import { IndexError } from "./errors.js";

/** RFC 8785: ECMAScript primitive serialization and UTF-16 property ordering.
 * Reject non-JSON inputs instead of allowing lossy coercions or lone surrogates.
 */
export function canonicalJson(value: unknown): string {
  const ancestors = new Set<object>();
  const visit = (item: unknown): string => {
    if (item === null) return "null";
    if (typeof item === "string") {
      if (/[\uD800-\uDFFF]/u.test(item)) throw new IndexError("INVALID_INPUT", "JSON含有未配对的Unicode代理项。");
      return JSON.stringify(item);
    }
    if (typeof item === "boolean") return item ? "true" : "false";
    if (typeof item === "number" && Number.isFinite(item)) return JSON.stringify(item);
    if (!item || typeof item !== "object" || ancestors.has(item)) throw new IndexError("INVALID_INPUT", "需要无循环的有效JSON。");
    const proto = Object.getPrototypeOf(item);
    if (!Array.isArray(item) && proto !== Object.prototype && proto !== null) throw new IndexError("INVALID_INPUT", "只接受普通JSON对象。");
    ancestors.add(item);
    try {
      if (Array.isArray(item)) {
        for (let i = 0; i < item.length; i++) if (!(i in item)) throw new IndexError("INVALID_INPUT", "不接受稀疏JSON数组。");
        return `[${item.map(visit).join(",")}]`;
      }
      return `{${Object.keys(item).sort().map(key => `${visit(key)}:${visit((item as Record<string, unknown>)[key])}`).join(",")}}`;
    } finally { ancestors.delete(item); }
  };
  return visit(value);
}
export const sha256 = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
export const digest = (value: unknown) => sha256(canonicalJson(value));
export const stableId = (prefix: string, value: unknown) => `${prefix}_${digest(value)}`;

/** JSON.parse silently accepts duplicate keys. Scan structure first, including escaped keys. */
export function parseStrictJson(text: string, maxBytes = 16 * 1024 * 1024): unknown {
  if (Buffer.byteLength(text) > maxBytes) throw new IndexError("INVALID_INPUT", "JSON超过大小限制。");
  let at = 0;
  const fail = (): never => { throw new IndexError("INVALID_INPUT", "JSON格式、重复键或嵌套深度无效。"); };
  const space = () => { while (/[\x20\t\r\n]/.test(text[at] ?? "x")) at++; };
  const string = (): string => {
    const start = at;
    if (text[at++] !== '"') return fail();
    while (at < text.length) {
      const char = text[at++];
      if (char === '\\') { at++; continue; }
      if (char === '"') { try { return JSON.parse(text.slice(start, at)) as string; } catch { return fail(); } }
    }
    return fail();
  };
  const scan = (depth: number): void => {
    if (depth > 64) fail();
    space();
    const c = text[at];
    if (c === '"') { string(); return; }
    if (c === "{" || c === "[") {
      const object = c === "{", end = object ? "}" : "]", keys = new Set<string>(); at++; space();
      if (text[at] === end) { at++; return; }
      for (;;) {
        if (object) { space(); const key = string(); if (keys.has(key)) fail(); keys.add(key); space(); if (text[at++] !== ":") fail(); }
        scan(depth + 1); space(); if (text[at] === end) { at++; return; } if (text[at++] !== ",") fail();
      }
    }
    const start = at; while (at < text.length && !/[\s,\]}]/.test(text[at])) at++;
    if (at === start) fail();
  };
  scan(0); space(); if (at !== text.length) fail();
  let value: unknown; try { value = JSON.parse(text); } catch { return fail(); }
  canonicalJson(value);
  return value;
}
