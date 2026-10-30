import { diagramTextWidth, type AsciiDiagram, type DiagramLabel } from "./ascii-diagram.js";

const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });

/** Text-fence-only static wireframes, not inferred interactive forms. Require
 * at least three empty fields, each paired with an aligned label on the row
 * immediately above. Never reinterpret populated brackets, lists or code. */
export function parseAsciiForm(source: string): AsciiDiagram | undefined {
  if (source.length > 24_000 || /[\t\x00-\x08\x0b\x0c\x0e-\x1f\x7f\u200e\u200f\u202a-\u202e\u2066-\u2069]/u.test(source)) return;
  // The shared SVG renderer anchors graphemes left-to-right; preserve RTL
  // text literally rather than reverse words or break contextual shaping.
  if (/[\u0590-\u08ff\ufb1d-\ufdff\ufe70-\ufefc\u{10800}-\u{10fff}\u{1e800}-\u{1eeff}]/u.test(source)) return;
  const lines = source.replace(/\r\n?/gu, "\n").split("\n");
  if (lines.length < 2 || lines.length > 120) return;
  while (lines.length && !lines.at(-1)!.trim()) lines.pop();
  let columns = 0, cells = 0;
  for (const line of lines) {
    const width = diagramTextWidth(line);
    columns = Math.max(columns, width); cells += width;
    if (width > 240 || cells > 16_000) return;
  }
  const fields: NonNullable<AsciiDiagram["fields"]> = [];
  const pairedRows = new Set<number>();
  const body = [...lines];
  for (const [y, line] of lines.entries()) {
    if (!/[\[\]]/u.test(line)) continue;
    const matches = [...line.matchAll(/\[(?: {3,}|─{3,}|-{3,})\]/gu)];
    // A field row contains only empty fields and ASCII spacing; no comma,
    // assignment, markdown link, checkbox state or unmatched bracket is valid.
    if (!matches.length || line.replace(/\[(?: {3,}|─{3,}|-{3,})\]/gu, "").replace(/ /gu, "")) return;
    const above = lines[y - 1];
    if (!above || pairedRows.has(y - 1) || /[\[\]{}();=<>|`\\\u2500-\u257f]/u.test(above)) return;
    const labels = [...above.matchAll(/\S(?:.*?\S)?(?= {2,}|$)/gu)];
    if (labels.length !== matches.length) return;
    for (const [i, match] of matches.entries()) {
      const label = labels[i];
      if (!/^\p{L}[\p{L}\p{N}\p{M} _/·-]*$/u.test(label[0])) return;
      const x = diagramTextWidth(line.slice(0, match.index));
      const labelX = diagramTextWidth(above.slice(0, label.index));
      const next = matches[i + 1];
      const nextX = next ? diagramTextWidth(line.slice(0, next.index)) : Infinity;
      // Permit small author spacing errors without moving source text. A label
      // must not overlap the following field's column or bleed into its label.
      if (Math.abs(x - labelX) > 2 || labelX + diagramTextWidth(label[0]) > nextX) return;
      fields.push({ x, y, width: match[0].length });
    }
    pairedRows.add(y - 1); pairedRows.add(y);
    body[y] = " ".repeat(line.length);
  }
  if (fields.length < 3) return;
  // Outside paired rows accept plain captions/actions only, not mixed flow
  // drawings or executable syntax. Full-source fallback avoids eating prose.
  if (body.some((line, y) => !pairedRows.has(y) && /[\[\]{}();=<>|`\\\u2500-\u257f]|[-+]{2,}|[←→↑↓]/u.test(line))) return;
  const labels: DiagramLabel[] = [];
  for (const [y, line] of body.entries()) {
    let x = 0, label: DiagramLabel | undefined;
    for (const { segment } of segmenter.segment(line)) {
      const width = diagramTextWidth(segment);
      if (/^\s+$/u.test(segment)) label = undefined;
      else if (label) { label.text += segment; label.width += width; }
      else { label = { x, y, width, text: segment }; labels.push(label); }
      x += width;
    }
  }
  return { columns, rows: lines.length, strokes: [], labels, fields };
}
