import { useEffect, useState } from "react";

let sequence = 0;
let rendering: Promise<unknown> = Promise.resolve();
async function renderDiagram(text: string, theme: string, cancelled: () => boolean): Promise<string> {
  const { default: mermaid } = await import("mermaid");
  // Mermaid has global configuration; serialize initialization and rendering.
  const job = rendering.catch(() => {}).then(async () => {
    if (cancelled()) return "";
    mermaid.initialize({
      startOnLoad: false, securityLevel: "strict", theme: theme === "light" ? "default" : "dark",
      htmlLabels: false, suppressErrorRendering: true, maxTextSize: 50_000, maxEdges: 500,
      secure: ["securityLevel", "startOnLoad", "maxTextSize", "maxEdges", "suppressErrorRendering", "htmlLabels"],
    });
    const host = document.createElement("div");
    host.style.cssText = "position:fixed;left:-100000px;top:0;visibility:hidden;pointer-events:none";
    document.body.append(host);
    try {
      const { svg } = await mermaid.render(`axiom-mermaid-${++sequence}`, text, host);
      // An SVG image cannot execute scripts, bind clicks or inherit global icon CSS.
      const document = new DOMParser().parseFromString(svg, "image/svg+xml");
      const root = document.documentElement;
      const bounds = root.getAttribute("viewBox")?.trim().split(/[\s,]+/).map(Number);
      if (bounds?.length === 4 && bounds.every(Number.isFinite) && bounds[2] > 0 && bounds[3] > 0) {
        root.setAttribute("width", String(bounds[2])); root.setAttribute("height", String(bounds[3]));
      }
      return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(root))}`;
    } finally { host.remove(); }
  });
  rendering = job;
  return job;
}
export function MermaidDiagram({ text }: { text: string }) {
  const [theme, setTheme] = useState(() => document.documentElement.dataset.theme ?? "dark");
  const [result, setResult] = useState<{ text: string; theme: string; image?: string; error?: boolean }>();
  useEffect(() => {
    const observer = new MutationObserver(() => setTheme(document.documentElement.dataset.theme ?? "dark"));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      if (!text.trim() || text.length > 50_000) { setResult({ text, theme, error: true }); return; }
      void renderDiagram(text, theme, () => cancelled).then(image => {
        if (!cancelled) setResult({ text, theme, image });
      }).catch(() => {
        if (!cancelled) setResult({ text, theme, error: true });
      });
    }, 300);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [text, theme]);
  const current = result?.text === text && result.theme === theme ? result : undefined;
  return current?.image ? <div className="mermaid-preview"><img src={current.image} alt="Mermaid 图表" /></div> : <>
    <div className="code-notice" role="status">{current?.error ? "暂时无法绘制图表，请检查 Mermaid 语法；源码仍可查看和复制。" : "正在绘制图表…"}</div>
    <pre><code>{text}</code></pre>
  </>;
}
