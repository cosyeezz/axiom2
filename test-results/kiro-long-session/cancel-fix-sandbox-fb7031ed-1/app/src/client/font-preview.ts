import type { OnlineFont } from "./font-library.js";

// A preview contains only requested glyphs, never SavedFont data or a full-font URL.
export const MAX_PREVIEW_BYTES = 512 * 1024;
export const previewFontFamily = (font: OnlineFont) => `AxiomPreview-${font.id.slice(7)}`;

async function readLimited(response: Response, limit: number): Promise<Uint8Array<ArrayBuffer>> {
  if (!response.ok) throw Error(`预览加载失败（HTTP ${response.status}），请重试。`);
  if (Number(response.headers.get("content-length")) > limit) {
    await response.body?.cancel();
    throw Error("预览资源过大，已停止加载；请减少试阅文字。");
  }
  const reader = response.body?.getReader();
  if (!reader) throw Error("当前浏览器无法加载字体预览。");
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > limit) { await reader.cancel(); throw Error("预览资源过大，已停止加载；请减少试阅文字。"); }
    chunks.push(value);
  }
  const data = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { data.set(chunk, offset); offset += chunk.byteLength; }
  return data;
}

/** Caller owns cancellation, registration and release of the returned face. */
export async function loadFontPreview(font: OnlineFont, text: string, signal: AbortSignal): Promise<FontFace> {
  if (!font.family) throw Error("此字体暂不支持轻量预览，可下载后试阅。");
  const axes = font.style === "italic" ? `ital,wght@1,${font.weight ?? 400}` : `wght@${font.weight ?? 400}`;
  const url = new URL("https://fonts.googleapis.com/css2");
  url.searchParams.set("family", `${font.family}:${axes}`);
  url.searchParams.set("text", [...new Set(text)].sort().join(""));
  url.searchParams.set("display", "swap");
  const options: RequestInit = { signal, credentials: "omit", referrerPolicy: "no-referrer" };
  const css = new TextDecoder().decode(await readLimited(await fetch(url, options), 64 * 1024));
  const source = css.match(/url\(['"]?(https:\/\/fonts\.gstatic\.com\/[^)'"\s]+)['"]?\)/)?.[1];
  if (!source) throw Error("此字体暂不支持轻量预览，可下载后试阅。");
  const data = await readLimited(await fetch(source, options), MAX_PREVIEW_BYTES);
  signal.throwIfAborted();
  const face = await new FontFace(previewFontFamily(font), data.buffer, { weight: String(font.weight ?? 400), style: font.style ?? "normal" }).load();
  signal.throwIfAborted();
  return face;
}
