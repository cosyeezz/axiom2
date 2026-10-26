import { previewArchive } from "./preview-archive.js";
import type { FilePreview } from "../shared/file-preview.js";

export const archiveExtension = /\.(?:zip|tar|tgz|gz)$/i;
export const officeExtension = /\.(?:docx|xlsx|pptx)$/i;
export const mediaExtension = /\.(?:mp3|wav|ogg|oga|opus|flac|m4a|aac|mp4|m4v|webm|ogv|mov)$/i;
export function mediaMime(bytes: Buffer, name: string): { kind: "audio" | "video"; mimeType: string } | null {
  const text = (a: number, b: number) => bytes.subarray(a, b).toString("ascii");
  if (/\.wav$/i.test(name) && text(0, 4) === "RIFF" && text(8, 12) === "WAVE") return { kind: "audio", mimeType: "audio/wav" };
  if (/\.mp3$/i.test(name) && (text(0, 3) === "ID3" || bytes[0] === 255 && (bytes[1] & 0xe0) === 0xe0)) return { kind: "audio", mimeType: "audio/mpeg" };
  if (/\.flac$/i.test(name) && text(0, 4) === "fLaC") return { kind: "audio", mimeType: "audio/flac" };
  if (/\.(?:ogg|oga|opus|ogv)$/i.test(name) && text(0, 4) === "OggS") return { kind: /\.ogv$/i.test(name) ? "video" : "audio", mimeType: /\.ogv$/i.test(name) ? "video/ogg" : "audio/ogg" };
  if (/\.aac$/i.test(name) && bytes[0] === 255 && (bytes[1] & 0xf6) === 0xf0) return { kind: "audio", mimeType: "audio/aac" };
  if (/\.(?:mp4|m4v|m4a|mov)$/i.test(name) && text(4, 8) === "ftyp") return { kind: /\.m4a$/i.test(name) ? "audio" : "video", mimeType: /\.m4a$/i.test(name) ? "audio/mp4" : /\.mov$/i.test(name) ? "video/quicktime" : "video/mp4" };
  if (/\.webm$/i.test(name) && bytes.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))) return { kind: "video", mimeType: "video/webm" };
  return null;
}
/** Return only bounded document XML, never macros, external relationships, or embedded executables. */
export async function officePreview(bytes: Buffer, name: string, signal: AbortSignal): Promise<Pick<FilePreview, "kind" | "officeParts" | "resourceNotice">> {
  const wanted = (path: string) => path === "[Content_Types].xml" || path === "content.xml" || /^(?:word\/document|xl\/(?:workbook|sharedStrings)|xl\/_rels\/workbook\.xml\.rels|xl\/worksheets\/sheet\d+|ppt\/presentation|ppt\/_rels\/presentation\.xml\.rels|ppt\/slides\/slide\d+)\.xml$/.test(path) || ["xl/_rels/workbook.xml.rels", "ppt/_rels/presentation.xml.rels"].includes(path);
  const { contents } = await previewArchive(bytes, name, wanted, signal);
  const main = /\.docx$/i.test(name) ? "word/document.xml" : /\.xlsx$/i.test(name) ? "xl/workbook.xml" : /\.pptx$/i.test(name) ? "ppt/presentation.xml" : "content.xml";
  if (!contents.has(main)) throw Error("缺少文档主体；文件可能已加密或格式不符");
  let total = 0;
  const officeParts = [...contents].map(([name, bytes]) => {
    if (bytes.length > 2 * 1024 * 1024 || (total += bytes.length) > 8 * 1024 * 1024) throw Error("Office XML 超过单份 2 MiB / 合计 8 MiB 上限");
    const encoding = bytes[0] === 255 && bytes[1] === 254 ? "utf-16le" : bytes[0] === 254 && bytes[1] === 255 ? "utf-16be" : "utf-8";
    const text = new TextDecoder(encoding, { fatal: true }).decode(bytes);
    if (/<!DOCTYPE|<!ENTITY/i.test(text)) throw Error("Office XML 含不允许的外部实体声明");
    return { name, text };
  });
  return { kind: "office", officeParts, resourceNotice: "内容阅读模式：段落、表格、工作表和幻灯片文字；不执行宏、公式或外链，不保证原版排版。" };
}
