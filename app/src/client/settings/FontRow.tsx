import { useEffect, useRef, useState } from "react";
import { customFontFamily, type OnlineFont, type SavedFont } from "../font-library.js";

/** Only visible names request a small text subset, never a complete font file. */
export function FontRow({ font, online, selected, available, active, disabled, onSelect }: {
  font: OnlineFont | SavedFont; online?: OnlineFont; selected: boolean; available: boolean; active: boolean; disabled: boolean; onSelect: () => void;
}) {
  const element = useRef<HTMLButtonElement>(null);
  const [visible, setVisible] = useState(false), [specimen, setSpecimen] = useState(false);
  const labelFamily = `AxiomLabel-${font.id.slice(7)}`;
  useEffect(() => {
    const observer = new IntersectionObserver(entries => setVisible(entries[0].isIntersecting));
    if (element.current) observer.observe(element.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!visible || available || !online?.family) return;
    const controller = new AbortController(); let face: FontFace | undefined;
    void (async () => {
      try {
        const axes = online.style === "italic" ? `ital,wght@1,${online.weight ?? 400}` : `wght@${online.weight ?? 400}`;
        const url = new URL("https://fonts.googleapis.com/css2");
        url.searchParams.set("family", `${online.family}:${axes}`); url.searchParams.set("text", font.name); url.searchParams.set("display", "swap");
        const css = await fetch(url, { signal: controller.signal, credentials: "omit", referrerPolicy: "no-referrer" });
        if (!css.ok) return;
        const source = (await css.text()).match(/url\(['"]?(https:\/\/fonts\.gstatic\.com\/[^)'"\s]+)['"]?\)/)?.[1];
        if (!source) return;
        const response = await fetch(source, { signal: controller.signal, credentials: "omit", referrerPolicy: "no-referrer" });
        if (!response.ok) return;
        const data = await response.arrayBuffer();
        if (controller.signal.aborted) return;
        face = await new FontFace(labelFamily, data).load();
        if (controller.signal.aborted) return;
        document.fonts.add(face); setSpecimen(true);
      } catch { /* The readable name remains available when the specimen service is offline. */ }
    })();
    return () => { controller.abort(); if (face) document.fonts.delete(face); setSpecimen(false); };
  }, [visible, available, online, font.name, labelFamily]);
  const style = available ? { fontFamily: customFontFamily(font.id) } : specimen ? { fontFamily: `"${labelFamily}", system-ui` } : undefined;
  return <button ref={element} type="button" className="font-row" aria-pressed={selected} disabled={disabled} onClick={onSelect} data-specimen={available || specimen || undefined}>
    <span className="font-row-name" style={style}>{font.name}</span>
    <span className="font-row-meta">{active ? "使用中" : available ? "已加载" : online?.description.split(" · ").slice(0, 2).join(" · ") ?? "本地字体"}</span>
  </button>;
}
