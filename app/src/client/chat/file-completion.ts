export interface FileSuggestion {
  value: string;
  label: string;
  description?: string;
}
export interface FileSuggestions {
  items: FileSuggestion[];
  prefix: string;
}

// Only ask the native pi provider while editing an @ token, not an email address.
export function atFileToken(text: string, cursor: number) {
  return /(?:^|[\s（【「『，。；：、([{])@(?:"[^"\n]*|[^\s"@]*)$/u.test(text.slice(0, cursor));
}

// Mirrors pi's @ completion insertion semantics; discovery/ranking stays in pi.
export function insertFileSuggestion(text: string, cursor: number, prefix: string, item: FileSuggestion) {
  if (!prefix.startsWith("@") || text.slice(cursor - prefix.length, cursor) !== prefix) return null;
  const start = cursor - prefix.length;
  let tail = text.slice(cursor);
  if (prefix.startsWith('@"') && item.value.endsWith('"') && tail.startsWith('"')) tail = tail.slice(1);
  const directory = item.label.endsWith("/"), suffix = directory ? "" : " ";
  return {
    text: text.slice(0, start) + item.value + suffix + tail,
    cursor: start + item.value.length + suffix.length - (directory && item.value.endsWith('"') ? 1 : 0),
  };
}
