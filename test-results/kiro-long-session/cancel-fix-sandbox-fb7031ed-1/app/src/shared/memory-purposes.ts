import { memoryOutline } from "./memory-outline.js";
import { assertMemoryTreeEdit, memoryDetails } from "./memory-detail-paths.js";

/** A title-ancestry locator, not a purpose ID. IDs belong to the service. */
export interface PurposeHeading {
  key: string; title: string; state: string; complete: boolean; detailPaths: string[];
  line: number; endLine: number; content: string;
}
/** Only status-bearing, heading-only task trees are indexable. Never infer a goal from prose. */
export function memoryPurposes(entry: string): PurposeHeading[] {
  try { assertMemoryTreeEdit("", entry); } catch { return []; }
  const body = entry.replace(/^\uFEFF/, ""), lines = body.split(/\r?\n/), original = body.split(/\r?\n/);
  if (lines.some(line => line.trim() && !/^#{1,6}\s+/.test(line))) return [];
  const outline = memoryOutline(body);
  if (outline.titleLine !== null || outline.nodes.some(node => !node.state || !node.title)) return [];
  const roots = outline.nodes.filter(node => node.parent === null);
  if (roots.some(node => !/^#\s+/.test(lines[node.line]))) return [];
  let details: ReturnType<typeof memoryDetails>;
  try { details = memoryDetails(entry); } catch { return []; }
  return roots.map(node => {
    const content = original.slice(node.line, node.endLine).join("\n");
    const unfinished = outline.nodes.some(child => child.line > node.line && child.line < node.endLine && !child.abandoned &&
      (child.state === "未开始" || child.state === "进行中" || child.state === "等待" || child.state === "阻塞"));
    return { key: JSON.stringify([node.title.normalize("NFC")]), title: node.title, state: node.state!,
      complete: node.state === "已完成" && !node.abandoned && !unfinished,
      detailPaths: details.filter(detail => detail.node.line >= node.line && detail.node.line < node.endLine).map(detail => detail.path),
      line: node.line, endLine: node.endLine, content };
  });
}
