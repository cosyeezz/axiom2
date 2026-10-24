export type CustomFontId = `custom:${string}`;
export type SavedFont = { id: CustomFontId; name: string; data: ArrayBuffer; source?: string; license?: string; weight?: string; style?: string };
export type FontLibrary = { fonts: SavedFont[]; loading: boolean; available: boolean; error: string };
export const MAX_FONT_BYTES = 30 * 1024 * 1024;
const DATABASE = "axiom.fonts.v1", CHANGE_KEY = "axiom.fonts.changed";
let state: FontLibrary = { fonts: [], loading: true, available: false, error: "" };
let initialization: Promise<void> | undefined;
let revision = 0;
const listeners = new Set<() => void>();
const faces = new Map<string, FontFace>();
const decoding = new Map<string, Promise<FontFace>>();
const previewFaces = new Set<string>();
export function isCustomFontId(value: unknown): value is CustomFontId {
  return typeof value === "string" && /^custom:[a-z0-9-]{1,80}$/.test(value);
}
export function customFontFamily(id: CustomFontId) { return `"AxiomFont-${id.slice(7)}", system-ui, sans-serif`; }
export function getFontLibrary() { return state; }
export function subscribeFontLibrary(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }
function publish(next: FontLibrary) { state = next; listeners.forEach(listener => listener()); }
function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => request.result.createObjectStore("fonts", { keyPath: "id" });
    let blocked = false;
    request.onsuccess = () => {
      if (blocked) { request.result.close(); return; }
      request.result.onversionchange = () => request.result.close(); resolve(request.result);
    };
    request.onerror = () => reject(new Error("无法打开字体存储，请检查浏览器存储权限。"));
    request.onblocked = () => { blocked = true; reject(new Error("字体存储被其他窗口占用，请关闭旧窗口后重试。")); };
  });
}
function checkFontCanceled(signal?: AbortSignal) { if (signal?.aborted) throw Error("已取消字体操作。"); }
async function transact<T>(mode: IDBTransactionMode, operation: (store: IDBObjectStore) => IDBRequest<T>, signal?: AbortSignal): Promise<T> {
  const db = await openDatabase();
  try {
    checkFontCanceled(signal);
    return await new Promise<T>((resolve, reject) => {
      const transaction = db.transaction("fonts", mode), request = operation(transaction.objectStore("fonts"));
      const abort = () => { try { transaction.abort(); } catch { /* A committed transaction cannot be canceled. */ } };
      const cleanup = () => signal?.removeEventListener("abort", abort);
      signal?.addEventListener("abort", abort, { once: true });
      transaction.oncomplete = () => { cleanup(); resolve(request.result); };
      transaction.onabort = transaction.onerror = () => { cleanup(); reject(new Error(signal?.aborted ? "已取消字体操作。" : "字体保存失败，可能存储空间不足或浏览器禁止存储。")); };
    });
  } finally { db.close(); }
}
export function validateFontFile(name: string, size: number) {
  if (!/\.(ttf|otf|woff2?)$/i.test(name)) throw new Error("请选择 TTF、OTF、WOFF 或 WOFF2 字体文件。");
  if (!size || size > MAX_FONT_BYTES) throw new Error("字体文件须大于 0 且不超过 30 MB。");
}
async function decodeFace(font: SavedFont): Promise<FontFace> {
  const registered = faces.get(font.id);
  if (registered) return registered;
  const pending = decoding.get(font.id);
  if (pending) return pending;
  const header = new Uint8Array(font.data, 0, Math.min(4, font.data.byteLength));
  const signature = Array.from(header).map(byte => String.fromCharCode(byte)).join("");
  if (!(signature === "OTTO" || signature === "wOFF" || signature === "wOF2" || signature === "true" || header.join(",") === "0,1,0,0")) {
    throw new Error("文件不是有效字体，请选择 TTF、OTF、WOFF 或 WOFF2 文件。");
  }
  const result = new FontFace(`AxiomFont-${font.id.slice(7)}`, font.data, { weight: font.weight ?? "normal", style: font.style ?? "normal" }).load().catch(() => {
    decoding.delete(font.id);
    throw new Error("无法读取此字体，文件可能已损坏或当前浏览器不支持。");
  });
  decoding.set(font.id, result);
  return result;
}
function registerFace(id: string, face: FontFace) {
  const previous = faces.get(id);
  if (previous === face) return;
  if (previous) document.fonts.delete(previous);
  document.fonts.add(face); faces.set(id, face);
}
async function reloadLibrary() {
  const current = ++revision;
  try {
    const stored = await transact<SavedFont[]>("readonly", store => store.getAll());
    const fonts: SavedFont[] = [], decoded = new Map<string, FontFace>();
    let error = "";
    for (const font of stored) {
      try {
        if (!isCustomFontId(font.id) || typeof font.name !== "string" || !(font.data instanceof ArrayBuffer) || font.data.byteLength > MAX_FONT_BYTES) throw Error("无效的字体记录");
        decoded.set(font.id, await decodeFace(font)); fonts.push(font);
      } catch { error = "部分已保存字体无法加载，请重新导入。"; }
    }
    if (current !== revision) return;
    // Only the latest database snapshot may register decoded faces.
    for (const previous of state.fonts) {
      if (!decoded.has(previous.id)) { previewFaces.delete(previous.id); downloads.delete(previous.id); }
    }
    for (const [id, face] of faces) {
      if (!decoded.has(id) && !previewFaces.has(id)) { document.fonts.delete(face); faces.delete(id); }
    }
    for (const id of decoding.keys()) if (!decoded.has(id) && !previewFaces.has(id)) decoding.delete(id);
    for (const [id, face] of decoded) registerFace(id, face);
    publish({ fonts, loading: false, available: true, error });
  } catch (error) {
    if (current === revision) publish({ ...state, loading: false, available: false, error: error instanceof Error ? error.message : "无法读取已保存字体。" });
  }
}
export async function reloadFontLibrary() {
  publish({ ...state, loading: true, error: "" });
  await reloadLibrary();
}
export function initializeFontLibrary() {
  if (!initialization) {
    initialization = reloadLibrary();
    window.addEventListener("storage", event => { if (event.key === CHANGE_KEY || event.key === null) void reloadLibrary(); });
  }
  return initialization;
}
function notifyOtherWindows() {
  try { localStorage.setItem(CHANGE_KEY, `${Date.now()}-${Math.random()}`); } catch { /* IndexedDB remains usable without localStorage. */ }
}
export async function saveFont(font: SavedFont, signal?: AbortSignal) {
  checkFontCanceled(signal);
  await initializeFontLibrary();
  checkFontCanceled(signal);
  await decodeFace(font);
  checkFontCanceled(signal);
  await transact("readwrite", store => store.put(font), signal);
  await reloadLibrary();
  notifyOtherWindows();
  return font;
}
export async function importFont(file: File, signal?: AbortSignal) {
  validateFontFile(file.name, file.size);
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  const id: CustomFontId = `custom:${Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("")}`;
  try { return await saveFont({ id, name: file.name.replace(/\.(ttf|otf|woff2?)$/i, ""), data: await file.arrayBuffer() }, signal); }
  catch (error) { if (!faces.has(id)) decoding.delete(id); throw error; }
}
export async function removeFont(id: CustomFontId) {
  await transact("readwrite", store => store.delete(id));
  await reloadLibrary();
  notifyOtherWindows();
}

export type OnlineFont = { id: CustomFontId; name: string; description: string; url: string; source: string; license: string; licenseUrl: string; category?: string; languages?: string[]; bytes?: number; aliases?: string; family?: string; weight?: number; style?: string; variable?: boolean };
// Keep only the current specimen in memory when browsing a large catalog.
// Saved fonts remain registered and available offline.
export function releaseFontPreviews(keepId?: string) {
  for (const id of previewFaces) {
    if (id === keepId) continue;
    previewFaces.delete(id); downloads.delete(id);
    if (!state.fonts.some(font => font.id === id)) {
      const face = faces.get(id);
      if (face) document.fonts.delete(face);
      faces.delete(id); decoding.delete(id);
    }
  }
}
// Full font bytes are fetched only by the explicit download action.
// Staged faces are temporary until saved; text-subset previews never enter this cache.
const downloads = new Map<string, Promise<SavedFont>>();
export async function downloadOnlineFont(font: OnlineFont, signal?: AbortSignal, progress?: (bytes: number) => void): Promise<SavedFont> {
  const checkCanceled = () => { if (signal?.aborted) throw Error("已取消字体下载。"); };
  checkCanceled();
  const saved = state.fonts.find(item => item.id === font.id);
  if (saved) return saved;
  let download = downloads.get(font.id);
  if (!download) {
    download = (async () => {
      const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 180_000);
      const abort = () => controller.abort();
      signal?.addEventListener("abort", abort, { once: true });
      if (signal?.aborted) controller.abort();
      try {
        const response = await fetch(font.url, { signal: controller.signal, credentials: "omit", referrerPolicy: "no-referrer" });
        if (!response.ok) throw Error(`下载失败（HTTP ${response.status}），请稍后重试。`);
        if (Number(response.headers.get("content-length")) > MAX_FONT_BYTES) throw Error("字体文件超过 30 MB。");
        const reader = response.body?.getReader();
        if (!reader) throw Error("当前浏览器无法下载字体，请尝试本地导入。");
        const chunks: Uint8Array<ArrayBuffer>[] = [];
        let length = 0;
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          length += value.byteLength;
          if (length > MAX_FONT_BYTES) { await reader.cancel(); throw Error("字体文件超过 30 MB。"); }
          chunks.push(value);
          progress?.(length);
        }
        const data = new Uint8Array(length);
        let offset = 0;
        for (const chunk of chunks) { data.set(chunk, offset); offset += chunk.length; }
        const result: SavedFont = { id: font.id, name: font.name, data: data.buffer, source: font.source, license: font.license, weight: font.variable ? "1 1000" : String(font.weight ?? 400), style: font.style ?? "normal" };
        await decodeFace(result);
        checkCanceled();
        if (controller.signal.aborted) throw Error("字体下载超时，请重试。");
        return result;
      } catch (error) {
        if (signal?.aborted) throw Error("已取消字体下载。");
        if (controller.signal.aborted) throw Error("字体下载超时，请检查网络后重试，或从来源网站下载后导入。");
        if (error instanceof TypeError) throw Error("无法连接字体来源，请检查网络后重试，或下载字体文件后导入。");
        throw error;
      } finally { clearTimeout(timer); signal?.removeEventListener("abort", abort); }
    })();
    downloads.set(font.id, download);
    download.catch(() => {
      if (downloads.get(font.id) !== download) return;
      downloads.delete(font.id);
      if (!previewFaces.has(font.id) && !state.fonts.some(item => item.id === font.id)) decoding.delete(font.id);
    });
  }
  const result = await download;
  checkCanceled();
  const face = await decodeFace(result);
  checkCanceled();
  previewFaces.add(result.id); registerFace(result.id, face);
  return result;
}
