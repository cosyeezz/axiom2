import { command } from "../transport.js";
import type { OpenFileDialogRequest } from "../OpenFileDialog.js";
import type { PickedAttachment } from "../../shared/protocol.js";
import "../styles/remote-files.css";
type Directory = { path: string; parent: string; total: number; offset: number; entries: { name: string; path: string; directory: boolean }[] };
export function remoteFileDialog(options: OpenFileDialogRequest, signal: AbortSignal): Promise<PickedAttachment[]> {
  return new Promise((resolve, reject) => {
    const previous = document.activeElement as HTMLElement | null;
    const dialog = document.createElement("dialog"); dialog.className = "remote-file-dialog"; dialog.setAttribute("aria-label", "选择电脑文件");
    dialog.innerHTML = '<header><div><small>电脑上的文件</small><h2>选择项目文件夹</h2></div><button class="action-icon" aria-label="关闭选择"><svg class="ui-glyph" aria-hidden="true"><use href="#i-close"/></svg></button></header><form><label for="remote-path">目录路径</label><div><input id="remote-path" autocomplete="off" placeholder="输入电脑上的目录路径"><button>前往</button></div></form><nav><button type="button"><svg class="ui-glyph" aria-hidden="true"><use href="#i-arrow"/></svg>上一级</button><span></span></nav><p role="status"></p><div class="remote-file-list"></div><footer><span></span><button type="button">选择此文件夹</button></footer>';
    const pathInput = dialog.querySelector("input")!, list = dialog.querySelector(".remote-file-list")!, status = dialog.querySelector('[role="status"]')!, foot = dialog.querySelector("footer span")!, select = dialog.querySelector("footer button") as HTMLButtonElement;
    let current: Directory | undefined, revision = 0, finished = false;
    const selected = new Set<string>();
    if (options.purpose === "attachment") { dialog.querySelector("h2")!.textContent = "选择文件或文件夹"; select.textContent = "添加所选附件"; }
    function done(items?: PickedAttachment[], error?: unknown) { if (finished) return; finished = true; revision++; signal.removeEventListener("abort", abort); dialog.close(); dialog.remove(); previous?.focus({ preventScroll: true }); if (error) reject(error); else resolve(items ?? []); }
    const abort = () => done(undefined, signal.reason); signal.addEventListener("abort", abort, { once: true });
    dialog.querySelector("header button")!.addEventListener("click", () => done()); dialog.addEventListener("cancel", (e) => { e.preventDefault(); done(); });
    function update() { foot.textContent = options.purpose === "workspace" ? "在电脑上打开项目，手机接续对话" : `已选 ${selected.size} 项`; select.disabled = !current || options.purpose === "attachment" && !selected.size; }
    async function load(path = "", offset = 0) {
      const rev = ++revision; status.textContent = "正在读取目录…";
      try {
        const response = await fetch(`/api/files/browse?${new URLSearchParams({ path, offset: String(offset) })}`, { signal }); const data = await response.json();
        if (!response.ok) throw Error(data.error || "目录无法读取"); if (finished || rev !== revision) return;
        current = data; pathInput.value = data.path; list.replaceChildren(); dialog.querySelector("nav span")!.textContent = `${data.total} 项`; status.textContent = "";
        for (const entry of (data as Directory).entries) {
          if (options.purpose === "workspace" && !entry.directory) continue;
          const row = document.createElement("div"); row.className = "remote-file-row";
          if (options.purpose === "attachment") {
            const checkbox = document.createElement("input"); checkbox.type = "checkbox"; checkbox.checked = selected.has(entry.path); checkbox.setAttribute("aria-label", `选择 ${entry.name}`);
            checkbox.onchange = () => { checkbox.checked ? selected.add(entry.path) : selected.delete(entry.path); update(); }; row.append(checkbox);
          }
          const item = document.createElement("button"); item.type = "button";
          item.innerHTML = `<svg class="ui-glyph" aria-hidden="true"><use href="#i-${entry.directory ? "workspace" : "tool-read"}"/></svg>`;
          const label = document.createElement("span"); label.textContent = entry.name; item.append(label);
          item.onclick = () => { if (entry.directory) void load(entry.path); else { const checkbox = row.querySelector("input"); checkbox?.click(); } }; row.append(item); list.append(row);
        }
        if (data.offset > 0 || data.offset + 200 < data.total) {
          const paging = document.createElement("div"); paging.className = "remote-file-paging";
          for (const [label, target] of [["上一页", data.offset - 200], ["下一页", data.offset + 200]] as const) {
            const button = document.createElement("button"); button.textContent = label; button.disabled = target < 0 || target >= data.total; button.onclick = () => void load(data.path, target); paging.append(button);
          } list.append(paging);
        }
        update();
      } catch (error) { if (!finished && rev === revision) status.textContent = (error as Error).message; }
    }
    dialog.querySelector("form")!.onsubmit = (e) => { e.preventDefault(); void load(pathInput.value); };
    dialog.querySelector("nav button")!.addEventListener("click", () => { if (current) void load(current.parent); });
    select.onclick = async () => {
      select.disabled = true; status.textContent = "正在确认选择…";
      try {
        const response = await fetch("/api/files/browse", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ paths: options.purpose === "workspace" ? [current!.path] : [...selected], scope: options.purpose === "attachment" ? options.scope : undefined }), signal });
        const data = await response.json(); if (!response.ok) throw Error(data.error || "选择失败"); done(data.items);
      } catch (error) { if (!finished) { status.textContent = (error as Error).message; update(); } }
    };
    document.body.append(dialog); dialog.showModal(); update();
    if (options.purpose === "attachment") {
      const upload = document.createElement("input"); upload.type = "file"; upload.multiple = true; upload.hidden = true;
      const phone = document.createElement("button"); phone.type = "button"; phone.textContent = "手机文件"; phone.onclick = () => upload.click();
      dialog.querySelector("nav")!.append(phone, upload);
      upload.onchange = async () => {
        const files = [...(upload.files ?? [])]; if (!files.length) return;
        const items: PickedAttachment[] = [];
        let awaitingReceipt = false;
        const report = (message: string, state: "running" | "unknown" | "failed" = "running") => {
          status.innerHTML = `<svg class="upload-progress-icon" data-state="${state}" width="32" height="32" viewBox="0 0 32 32" aria-hidden="true"><use href="#i-upload" x="7" y="1" width="18" height="20"/><rect x="2" y="26" width="28" height="4" rx="2" fill="currentColor" opacity=".2"/><rect x="2" y="26" width="${28 * items.length / files.length}" height="4" rx="2" fill="currentColor"/>${state === "unknown" ? '<text x="26" y="12" fill="currentColor" font-size="12">?</text>' : state === "failed" ? '<use href="#i-triangle-alert" x="23" y="0" width="9" height="10"/>' : '<circle cx="28" cy="4" r="2" fill="currentColor"><animate attributeName="opacity" values="1;.25;1" dur="1s" repeatCount="indefinite"/></circle>'}</svg>`;
          const text = document.createElement("span"); text.textContent = `已确认 ${items.length}/${files.length} 个文件 · ${message}`; status.append(text);
        };
        phone.disabled = true; select.disabled = true; revision++;
        const controls = [dialog.querySelector("form")!, dialog.querySelector("nav")!, list] as HTMLElement[];
        controls.forEach(node => { node.inert = true; });
        try {
          if (files.length > 50 || files.some((file) => file.size > 10 * 1024 * 1024)) throw Error("每次最多 50 个文件，单个文件最多 10 MiB。");
          for (const [index, file] of files.entries()) {
            signal.throwIfAborted(); if (finished) return;
            report(`读取 ${file.name}`);
            const data = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(",")[1]); reader.onerror = () => reject(Error("文件读取失败")); reader.readAsDataURL(file); });
            signal.throwIfAborted(); if (finished) return;
            report(`等待 ${file.name} 的上传回执`);
            const image = file.type.startsWith("image/");
            awaitingReceipt = true;
            const item = await command<PickedAttachment>("files.upload", { name: file.name, data, id: image ? `imag${index + 1}` : `file${index + 1}`, kind: image ? "image" : "file" }, options.scope);
            awaitingReceipt = false;
            if (finished || signal.aborted) return;
            items.push({ name: item.name, path: item.path, kind: item.kind });
            report(`${file.name} 上传完成`);
          }
          done(items);
        } catch (error) { if (!finished) {
          const uncertain = awaitingReceipt && (error as { code?: string }).code === "UNCERTAIN";
          report(`${uncertain ? "当前文件结果待核实，请勿重复上传。" : "本次上传未全部完成。"}${(error as Error).message}${items.length ? " 已确认文件仍保留在电脑上。" : ""}`, uncertain ? "unknown" : "failed");
          phone.disabled = false; update();
        } } finally { controls.forEach(node => { node.inert = false; }); upload.value = ""; }
      };
    }
    if (signal.aborted) abort(); else void load();
  });
}
