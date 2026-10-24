import { useEffect, useRef, useState } from "react";
import { customFontFamily, type OnlineFont, type SavedFont } from "../font-library.js";
import { loadFontPreview, previewFontFamily } from "../font-preview.js";

export function FontSpecimen({ font, text, size, onChange }: {
  font: OnlineFont | SavedFont; text: string; size: number; onChange: (text: string) => void;
}) {
  const saved = "data" in font;
  const [loadedText, setLoadedText] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [composing, setComposing] = useState(false);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => {
    setError(""); setLoadedText(null);
    if ("data" in font || !text.trim() || composing) return;
    const next = new AbortController(); controller.current = next;
    let face: FontFace | undefined, timeout: ReturnType<typeof setTimeout> | undefined;
    let disposed = false, timedOut = false;
    // Typing requests only the latest specimen, not one request per keystroke.
    const debounce = setTimeout(() => {
      timeout = setTimeout(() => { timedOut = true; next.abort(); }, 20_000);
      void loadFontPreview(font, text, next.signal).then(result => {
        if (disposed || next.signal.aborted) return;
        face = result; document.fonts.add(face); setLoadedText(text);
      }).catch(error => {
        if (disposed) return;
        setError(timedOut ? "字体预览超时，请重试。" : next.signal.aborted ? "已取消字体预览。" : error instanceof TypeError ? "无法连接预览服务，请重试或下载字体后试阅。" : error instanceof Error ? error.message : "字体预览加载失败，请重试。");
      }).finally(() => { clearTimeout(timeout); });
    }, 300);
    return () => {
      disposed = true; next.abort(); clearTimeout(debounce); clearTimeout(timeout);
      if (face) document.fonts.delete(face);
      if (controller.current === next) controller.current = null;
    };
  }, [font, text, attempt, composing]);
  const loading = !saved && !!text.trim() && loadedText !== text && !error;
  const family = saved ? customFontFamily(font.id) : loadedText === text ? `"${previewFontFamily(font)}", system-ui, sans-serif` : "system-ui, sans-serif";
  return <>
    <textarea id="font-preview-text" className="font-specimen" aria-label="预览文字" aria-busy={loading} value={text} maxLength={500} spellCheck={false} onChange={event => onChange(event.currentTarget.value)} onCompositionStart={() => setComposing(true)} onCompositionEnd={() => setComposing(false)} style={{ fontFamily: family, fontSize: `${size}px` }} />
    {loading && <p className="font-status" role="status">正在加载文字子集，暂用系统字体…<button type="button" className="display-reset" onClick={() => { controller.current?.abort(); setError("已取消字体预览。"); }}>取消</button></p>}
    {error && <p className="display-theme-error" role="alert">{error}<button type="button" className="display-reset" onClick={() => setAttempt(value => value + 1)}>重新加载预览</button></p>}
  </>;
}
