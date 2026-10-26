// The editable projection never returns stored credential values. A placeholder
// only restores a value at the same JSON path in the revision-bound original.
const marker = "[已保存，保持此值以保留]";
const secret = /token|secret|password|passwd|authorization|(?:api|access|private|client)[-_]?key|credential/i;
export function configProjection(raw: unknown) {
  let masked = false;
  function visit(value: any, path: string[] = []): any {
    const key = path.at(-1) ?? "";
    if (typeof value === "string") {
      let sensitive = secret.test(key) || path.includes("env") || path.includes("headers");
      // CLI values are opaque: positional arguments and unknown short options can
      // carry passwords, DSNs, or shell code without a recognizable field name.
      if (path[0] === "args") sensitive = true;
      try { const url = new URL(value); sensitive ||= !!(url.username || url.password || url.search || url.hash); } catch { /* Preserve invalid nonsecret text for repair. */ }
      if (sensitive && value) { masked = true; return marker; }
      return value;
    }
    if (Array.isArray(value)) return value.map((entry, index) => visit(entry, [...path, String(index)]));
    if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, visit(entry, [...path, key])]));
    return value;
  }
  return { value: visit(raw), get masked() { return masked; } };
}
export function restoreConfig(submitted: unknown, original: unknown): unknown {
  const safe = configProjection(original).value;
  function restore(value: any, previous: any, displayed: any): any {
    if (value === marker) {
      if (displayed !== marker || typeof previous !== "string") throw Error("无对应已保存值");
      return previous;
    }
    if (Array.isArray(value)) return value.map((entry, i) => restore(entry, previous?.[i], displayed?.[i]));
    if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, restore(entry, previous?.[key], displayed?.[key])]));
    return value;
  }
  return restore(submitted, original, safe);
}
