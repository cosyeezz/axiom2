import { parentPort, workerData } from "node:worker_threads";
import { parseHTML } from "linkedom";
import { Defuddle } from "defuddle/node";
import { webReadLimits as limits } from "../../shared/web-read.js";

// Defence in depth for accidental async enrichment; this is NOT an OS network sandbox.
globalThis.fetch = async () => { throw Error("Extraction cannot fetch remote resources"); };
try {
  const { html, url } = workerData as { html: string; url: string };
  if (typeof html !== "string" || Buffer.byteLength(html) > limits.decodedBytes) throw Error("Invalid parser input");
  const { document } = parseHTML(html);
  Object.defineProperty(document, "URL", { value: url, configurable: true });
  Object.defineProperty(document, "styleSheets", { value: [] });
  Object.defineProperty(document.defaultView, "getComputedStyle", { value: () => ({ display: "" }), configurable: true });
  const title = document.title?.trim() ?? "";
  const challenge = /^(just a moment|attention required|verify (you|your)|security verification|人机验证|安全验证)/i.test(title) ||
    !!document.querySelector('form[action*="/sorry/"], #challenge-form, iframe[src*="captcha"], .g-recaptcha, .h-captcha');
  const visible = document.body?.textContent?.trim() ?? "";
  const shell = !document.querySelector("article") && visible.length < 1500;
  if (challenge) parentPort!.postMessage({ ok: false, code: "VERIFICATION_REQUIRED" });
  else if (shell && document.querySelector('input[type="password"]')) parentPort!.postMessage({ ok: false, code: "AUTH_REQUIRED" });
  else if (shell && /(?:enable|requires?|turn on) javascript|javascript (?:is required|must be enabled)|请启用.*javascript/i.test(visible)) parentPort!.postMessage({ ok: false, code: "NEEDS_BROWSER" });
  else {
    // Normalize relative links without fetching them; never keep executable URLs or images.
    let base = url;
    try { base = new URL(document.querySelector("base[href]")?.getAttribute("href") ?? url, url).href; } catch { /* Use final URL. */ }
    document.querySelectorAll("script, style, iframe, object, embed, img, picture, svg, form").forEach(node => node.remove());
    for (const a of document.querySelectorAll("a[href]")) {
      try { const link = new URL(a.getAttribute("href")!, base); if (!["http:", "https:"].includes(link.protocol)) a.removeAttribute("href"); else a.setAttribute("href", link.href); }
      catch { a.removeAttribute("href"); }
    }
    const result = await Defuddle(document as unknown as Document, url, { markdown: true, useAsync: false, removeImages: true, debug: false });
    const content = result.content?.trim() ?? "";
    if (!content) parentPort!.postMessage({ ok: false, code: "NEEDS_BROWSER" });
    else parentPort!.postMessage({ ok: true, title: (result.title || title).slice(0, 300),
      content: content.slice(0, limits.documentChars), complete: content.length <= limits.documentChars });
  }
} catch { parentPort!.postMessage({ ok: false, code: "EXTRACTION_FAILED" }); }
