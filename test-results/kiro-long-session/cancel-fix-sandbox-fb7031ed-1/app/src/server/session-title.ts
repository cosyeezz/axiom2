/** Shared IPC/storage validation; count Unicode code points, not UTF-16 units. */
export function validSessionTitle(value: unknown): string | undefined {
  if (typeof value !== "string") return;
  const title = value.trim().replace(/\s+/gu, " ");
  if (!title || [...title].length > 13 || /[<>\p{Cc}\p{Cs}]/u.test(title)) return;
  return title;
}

// Only the first nonempty line can own the marker. Up to three spaces are
// Markdown indentation; a tab/four spaces, fences, quotes and HTML parents are
// ordinary content. Do not scan later lines for a more convenient candidate.
const leading = /^(?:[ \t]*(?:\r\n|\n|\r))* {0,3}/;
const complete = /^<title>([^<>]*)<\/title>[ \t]*(?:\r\n|\n|\r|$)/i;
function titlePrefix(text: string): { title: string; end: number } | undefined {
  const start = leading.exec(text)![0].length;
  const match = complete.exec(text.slice(start));
  const title = match && [...match[1].trim().replace(/\s+/gu, " ")].length <= 10 && validSessionTitle(match[1]);
  if (match && title) return { title, end: start + match[0].length };
}

export function extractSessionTitle(text: string): string | undefined {
  return titlePrefix(text)?.title;
}

/** Display projection only: never write the stripped text back to pi history. */
export function stripSessionTitle(text: string, streaming = false): string {
  const prefix = titlePrefix(text);
  if (prefix) return text.slice(prefix.end);
  if (!streaming) return text;

  const candidate = text.slice(leading.exec(text)![0].length);
  const lower = candidate.toLowerCase();
  // Hold an undecidable opening prefix until it either becomes a marker or
  // ordinary content. Complete invalid markup is always restored verbatim.
  if ("<title>".startsWith(lower)) return "";
  if (!lower.startsWith("<title>")) return text;
  const rest = candidate.slice(7);
  const closeAt = rest.indexOf("<");
  const body = closeAt < 0 ? rest : rest.slice(0, closeAt);
  if (body.trim() && ([...body.trim().replace(/\s+/gu, " ")].length > 10 || !validSessionTitle(body))) return text;
  if (closeAt < 0) return "";
  if ("</title>".startsWith(rest.slice(closeAt).toLowerCase())) return "";
  return text;
}
