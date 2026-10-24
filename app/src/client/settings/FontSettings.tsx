import { Icon } from "../Icon.js";
import { maintenanceActive, maintenanceStatusLabels } from "../../shared/maintenance.js";
import { browserMaintenanceCommand, useBrowserMaintenance } from "../maintenance/browser-maintenance.js";
import { BudgetEditor, MaintenanceTaskView } from "../maintenance/MaintenanceView.js";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Select } from "../Select.js";
import { fontOptions, getDisplaySettings, setDisplaySettings, subscribeDisplaySettings } from "../display-settings.js";
import { downloadOnlineFont, getFontLibrary, importFont, releaseFontPreviews, reloadFontLibrary, removeFont, subscribeFontLibrary, type OnlineFont, type SavedFont } from "../font-library.js";
import { FontRow } from "./FontRow.js";
import { FontSpecimen } from "./FontSpecimen.js";
import catalogUrl from "../font-catalog.json?url";
import { formatFontCatalog, type FontCatalog } from "../format-font-catalog.js";

const sizeLabel = (bytes: number) => bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.ceil(bytes / 1024)} KB`;
const categories = [{ value: "all", label: "所有风格" }, { value: "sans-serif", label: "无衬线 / 黑体" }, { value: "serif", label: "衬线 / 宋体" }, { value: "monospace", label: "等宽" }, { value: "handwriting", label: "手写" }, { value: "display", label: "展示" }];
const languages = [{ value: "all", label: "所有语言" }, { value: "chinese", label: "中文" }, { value: "latin", label: "拉丁字母" }, { value: "other", label: "其他 / 未标注" }];
const defaultSample = "让阅读更舒适，灵感从这里开始。\nThe quick brown fox jumps over the lazy dog.\n0123456789 · Aa Bb Cc";
const emptyCatalog: OnlineFont[] = [];

export function FontSettings() {
  const maintenance = useBrowserMaintenance(), fontTask = maintenance.tasks.at(-1);
  const settings = useSyncExternalStore(subscribeDisplaySettings, getDisplaySettings);
  const library = useSyncExternalStore(subscribeFontLibrary, getFontLibrary);
  const [open, setOpen] = useState(false);
  const [catalog, setCatalog] = useState<OnlineFont[] | null>(null);
  const [catalogError, setCatalogError] = useState(""), [catalogAttempt, setCatalogAttempt] = useState(0);
  const onlineFonts = catalog ?? emptyCatalog;
  useEffect(() => {
    if (!open || catalog) return;
    let alive = true;
    setCatalogError("");
    // Fetch data rather than importing a module: failed module URLs are remembered
    // by browsers and cannot reliably be retried without reloading the whole page.
    void fetch(catalogUrl).then(async response => {
      if (!response.ok) throw new Error(`Font catalog: ${response.status}`);
      const data = await response.json() as FontCatalog;
      if (alive) setCatalog(formatFontCatalog(data));
    }).catch(() => { if (alive) setCatalogError("字体目录加载失败，请重试；本地字体仍可使用。若更新后仍失败，请刷新页面。"); });
    return () => { alive = false; };
  }, [open, catalog, catalogAttempt]);
  const [panel, setPanel] = useState<"saved" | "online">("online");
  const [query, setQuery] = useState("");
  const [language, setLanguage] = useState("all"), [category, setCategory] = useState("all");
  const [limit, setLimit] = useState(60);
  const [picked, setPicked] = useState<OnlineFont | SavedFont | null>(null);
  const [detail, setDetail] = useState(false);
  const [sample, setSample] = useState(defaultSample), [sampleSize, setSampleSize] = useState(28);
  const [busy, setBusy] = useState(""), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const input = useRef<HTMLInputElement>(null), dialog = useRef<HTMLDialogElement>(null), trigger = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null), detailHeading = useRef<HTMLHeadingElement>(null);
  const controller = useRef<AbortController | null>(null);
  const persistent = useRef(false);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; if (!persistent.current) controller.current?.abort(); releaseFontPreviews(); }; }, []);
  useEffect(() => {
    if (!open) return;
    const element = dialog.current!;
    element.showModal();
    return () => { element.close(); trigger.current?.focus({ preventScroll: true }); };
  }, [open]);
  useEffect(() => {
    if (!open || !picked) return;
    const narrow = window.matchMedia("(max-width: 640px)");
    const restoreDetail = () => { if (!narrow.matches) setDetail(true); };
    restoreDetail();
    narrow.addEventListener("change", restoreDetail);
    return () => narrow.removeEventListener("change", restoreDetail);
  }, [open, picked]);
  useEffect(() => { setLimit(60); if (list.current) list.current.scrollTop = 0; }, [query, language, category, panel]);
  const options = [...fontOptions, ...library.fonts.map(font => ({ value: font.id, label: font.name, group: "已添加字体" }))];
  if (!options.some(option => option.value === settings.fontFamily)) options.push({ value: settings.fontFamily, label: library.loading ? "正在加载字体…" : "字体不可用" });
  const filtered = useMemo(() => {
    const search = query.trim().toLocaleLowerCase();
    if (panel === "saved") return library.fonts.filter(font => font.name.toLocaleLowerCase().includes(search));
    return onlineFonts.filter(font => {
      const chinese = font.languages?.some(item => item.startsWith("chinese"));
      const matchesLanguage = language === "all" || (language === "chinese" ? chinese : language === "latin" ? font.languages?.includes("latin") : !font.languages?.length || font.languages.some(item => !item.startsWith("chinese") && !item.startsWith("latin")));
      return matchesLanguage && (category === "all" || font.category === category) && `${font.name} ${font.aliases ?? ""}`.toLocaleLowerCase().includes(search);
    });
  }, [query, panel, language, category, library.fonts, onlineFonts]);
  const saved = library.fonts.find(font => font.id === picked?.id);
  const online = picked ? onlineFonts.find(font => font.id === picked.id) : undefined;
  const active = !!picked && settings.fontFamily === picked.id;
  // A record removed by another window must not remain available for application.
  useEffect(() => {
    if (picked && "data" in picked && !library.loading && !saved) { setPicked(null); setDetail(false); requestAnimationFrame(() => dialog.current?.querySelector<HTMLInputElement>('input[type="search"]')?.focus({ preventScroll: true })); }
  }, [picked, saved, library.loading]);
  const run = async (label: string, action: (signal: AbortSignal) => Promise<void>, persist = false) => {
    if (controller.current) return;
    persistent.current = persist;
    const next = new AbortController(), startedInDialog = !!dialog.current?.open; controller.current = next;
    setBusy(label); setError(""); setNotice("");
    try { await action(next.signal); }
    catch (error) { if (alive.current && !(next.signal.aborted && startedInDialog && !dialog.current?.open)) setError(error instanceof Error ? error.message : "字体操作失败，请重试。"); }
    finally { if (alive.current) setBusy(""); controller.current = null; persistent.current = false; if (!dialog.current?.open) releaseFontPreviews(); }
  };
  const close = () => { if (!persistent.current) controller.current?.abort(); setOpen(false); setPicked(null); setDetail(false); setError(""); setNotice(""); releaseFontPreviews(); };
  const show = () => { setOpen(true); setDetail(false); setError(""); setNotice(""); };
  const select = (font: OnlineFont | SavedFont) => {
    if (controller.current) return;
    setPicked(font); setDetail(true); setError(""); setNotice(""); releaseFontPreviews(font.id);
    if (window.innerWidth <= 640) requestAnimationFrame(() => detailHeading.current?.focus({ preventScroll: true }));
  };
  const apply = () => {
    if (!saved) return;
    setDisplaySettings({ fontFamily: saved.id }); setNotice(`已使用 ${saved.name}`); setError("");
  };
  const status = <>
    {open && !catalog && !catalogError && <p className="font-status" role="status">正在加载字体目录…</p>}
    {open && catalogError && <p className="display-theme-error" role="alert">{catalogError}<button type="button" className="display-reset" onClick={() => setCatalogAttempt(value => value + 1)}>重试字体目录</button></p>}
    {(busy || notice) && <p className="font-status" role="status">{busy || notice}{busy && !persistent.current && <button type="button" className="display-reset" onClick={() => controller.current?.abort()}>取消</button>}</p>}
    {fontTask && (maintenanceActive(fontTask)
      ? <MaintenanceTaskView task={fontTask} compact showError={!error && !library.error} connected onCancel={persistent.current ? () => browserMaintenanceCommand("cancel", fontTask.id) : undefined} />
      : <details className="maintenance-details font-maintenance-settings"><summary><Icon name="history" /><span>上次字体任务 · {maintenanceStatusLabels[fontTask.status]}</span><Icon name="chevron-down" /></summary><MaintenanceTaskView task={fontTask} compact showError={!error && !library.error} connected /></details>)}
    <details className="maintenance-details font-maintenance-settings"><summary><Icon name="sliders-horizontal" /><span>字体下载设置</span><Icon name="chevron-down" /></summary><BudgetEditor value={fontTask && maintenanceActive(fontTask) ? fontTask.budgets : maintenance.budgets} running={!!fontTask && maintenanceActive(fontTask)} onSave={budgets => fontTask && maintenanceActive(fontTask) ? browserMaintenanceCommand("extend", fontTask.id, budgets) : browserMaintenanceCommand("defaults", undefined, budgets)} /></details>
    {maintenance.error && <p role="alert">{maintenance.error}</p>}
    {(error || library.error) && <p className="display-theme-error" role="alert">{error || library.error}</p>}
    {library.error && <button type="button" className="display-reset" disabled={!!busy || library.loading} onClick={() => void run("正在重新读取字体…", async () => { await reloadFontLibrary(); })}>重新读取字体</button>}
  </>;
  return <div className="font-settings">
    <div className="display-font"><label htmlFor="display-font-family">当前字体</label>
      <Select id="display-font-family" label="字体" value={settings.fontFamily} options={options} onChange={value => setDisplaySettings({ fontFamily: value as typeof settings.fontFamily })} /></div>
    <div className="font-entry"><span className="font-help">{catalog ? `${catalog.length.toLocaleString()} 款免费字体` : "免费字体 · 按需浏览"}</span><button ref={trigger} type="button" className="display-reset" onClick={show}>浏览字体库</button><button type="button" className="display-reset" disabled={!!busy || library.loading} onClick={() => input.current?.click()}>导入字体</button></div>
    <input ref={input} className="font-file-input" type="file" accept=".ttf,.otf,.woff,.woff2" aria-label="选择字体文件" disabled={!!busy || library.loading}
      onChange={event => {
        const file = event.currentTarget.files?.[0]; event.currentTarget.value = "";
        if (file) void run("正在导入字体…", async signal => {
          const font = await importFont(file, signal);
          if (!signal.aborted) { setPicked(font); setOpen(true); setDetail(true); setPanel("saved"); setQuery(""); setNotice(`已导入 ${font.name}，尚未使用。`); }
        });
      }} />
    {!open && status}
    {open && <dialog ref={dialog} className="font-browser" aria-labelledby="font-browser-title" onCancel={event => { event.preventDefault(); event.stopPropagation(); close(); }} onKeyDown={event => event.stopPropagation()}>
      <header className="font-browser-header"><div><h2 id="font-browser-title">字体库</h2><p className="font-help">挑选喜欢的字形，让阅读更顺眼。</p></div><button type="button" className="btn" onClick={close} aria-label="关闭字体库">关闭</button></header>
      <div className="font-browser-status">{status}</div>
      <div className="font-browser-body" data-detail={detail || undefined}>
        <section className="font-browser-sidebar" aria-label="浏览字体">
          <div className="font-browser-tools">
            <div className="font-library-tabs" role="group" aria-label="字体来源"><button type="button" aria-pressed={panel === "online"} onClick={() => setPanel("online")}>全部字体</button><button type="button" aria-pressed={panel === "saved"} onClick={() => setPanel("saved")}>已添加 ({library.fonts.length})</button></div>
            <input className="input" type="search" aria-label="搜索字体" placeholder="搜索名称，如 思源、Inter" value={query} onChange={event => setQuery(event.currentTarget.value)} autoFocus />
            {panel === "online" && <div className="font-filters"><Select label="字体语言" value={language} options={languages} onChange={setLanguage} /><Select label="字体风格" value={category} options={categories} onChange={setCategory} /></div>}
            <p className="font-result-count" role="status">{filtered.length.toLocaleString()} 款字体{panel === "online" ? " · 按需加载" : " · 当前设备"}</p>
          </div>
          <div ref={list} className="font-browser-list" aria-label="字体列表" onKeyDown={event => {
            if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
            const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>(".font-row:not(:disabled)")];
            const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
            if (index < 0) return;
            event.preventDefault(); buttons[event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : Math.max(0, Math.min(buttons.length - 1, index + (event.key === "ArrowDown" ? 1 : -1)))]?.focus();
          }}>
            {filtered.slice(0, limit).map(font => <FontRow key={font.id} font={font} online={"url" in font ? font : undefined} selected={picked?.id === font.id} available={library.fonts.some(item => item.id === font.id)} active={settings.fontFamily === font.id} disabled={!!busy} onSelect={() => select(font)} />)}
            {!filtered.length && (panel === "saved" || catalog) && <div className="font-empty"><p>{query || (panel === "online" && (language !== "all" || category !== "all")) ? "没有找到匹配的字体" : "还没有添加字体"}</p><button type="button" className="display-reset" onClick={() => { setQuery(""); setLanguage("all"); setCategory("all"); setPanel("online"); }}>查看全部字体</button></div>}
            {filtered.length > limit && <button type="button" className="font-more btn" onClick={() => setLimit(value => value + 60)}>显示更多（还有 {filtered.length - limit} 款）</button>}
          </div>
          <div className="font-list-footer"><button type="button" className="display-reset" disabled={!!busy || library.loading} onClick={() => input.current?.click()}>导入本地字体</button><span className="font-help">TTF / OTF / WOFF / WOFF2</span></div>
        </section>
        <section className="font-browser-detail" aria-label="字体预览">
          <button type="button" className="font-back display-reset" onClick={() => { setDetail(false); requestAnimationFrame(() => { const row = list.current?.querySelector<HTMLButtonElement>('[aria-pressed="true"]:not(:disabled)'); (row ?? dialog.current?.querySelector<HTMLInputElement>('input[type="search"]'))?.focus({ preventScroll: true }); }); }}>← 返回字体列表</button>
          {picked ? <>
            <div className="font-detail-copy"><h3 ref={detailHeading} tabIndex={-1}>{picked.name}</h3><p className="font-help">{online?.description ?? (saved ? `${sizeLabel(saved.data.byteLength)} · 本地导入` : "")}</p>
              {online && <div className="font-source-links"><a href={online.source} target="_blank" rel="noreferrer">字体来源 ↗</a><a href={online.licenseUrl} target="_blank" rel="noreferrer">{online.license} ↗</a></div>}
            </div>
            <div className="font-preview-toolbar"><label htmlFor="font-preview-text">预览文字</label><label className="font-size-label">字号 <input type="range" aria-label="预览字号" min={16} max={48} value={sampleSize} onChange={event => setSampleSize(Number(event.currentTarget.value))} /><output>{sampleSize}</output></label></div>
            {detail && <FontSpecimen key={picked.id} font={saved ?? picked} text={sample} size={sampleSize} onChange={setSample} />}
            <div className="font-detail-footer">
              <p className="font-help">{active ? "当前正在使用此字体。" : saved ? "已保存在此设备，可离线使用。" : "试阅文字会发送至 Google Fonts，仅加载所需字形；下载才获取并保存完整字体。"}{online && !online.languages?.some(item => item.startsWith("chinese")) ? " 中文使用系统字体。" : ""}</p>
              <div className="font-detail-actions">
                {saved ? <><button type="button" className="display-reset" disabled={!!busy} aria-label={`移除 ${picked.name}`} onClick={() => void run("正在移除字体…", async () => { await removeFont(saved.id); setNotice(`已移除 ${saved.name}`); })}>移除</button><button type="button" className="btn btn-primary" disabled={!!busy || active} onClick={apply}>{active ? "使用中" : "使用字体"}</button></>
                  : online && <button type="button" className="btn btn-primary" disabled={!!busy || library.loading} onClick={() => void run(`正在下载 ${online.name}…`, async signal => {
                    await downloadOnlineFont(online);
                    if (alive.current && dialog.current?.open) { setNotice(`已下载 ${online.name}，尚未使用。`); }
                  }, true)}>下载字体{online.bytes ? ` · ${sizeLabel(online.bytes)}` : ""}</button>}
              </div>
            </div>
          </> : <div className="font-browser-welcome"><span className="font-welcome-glyph" aria-hidden="true">Aa 字</span><h3>找到适合你的字体</h3><p>搜索名称，或按语言和风格筛选。<br />选择一款字体，即可在这里试阅。</p><p className="font-help">预览不改变当前字体。下载与使用分别操作。</p></div>}
        </section>
      </div>
    </dialog>}
  </div>;
}
