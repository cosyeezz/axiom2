/** Google SERP extraction adapted from @jackwener/opencli 2.0.2 clis/google/search.js.
 * Copyright 2025 jackwener, Apache-2.0; see app/licenses/OpenCLI.txt.
 * Axiom changes: bounded extraction, ad exclusion, short snippets, explicit diagnostics,
 * local redirect decoding, same-query pagination; never opens a result URL. */
export const googleSearchOrigins = new Set(["https://google.com", "https://www.google.com", "https://google.com.hk", "https://www.google.com.hk"]);
export interface SerpPage {
  kind: "results" | "empty" | "captcha" | "consent" | "unknown";
  items: { title: string; url: string; snippet: string }[];
  nextStart?: number;
}
// A fixed expression, not model-provided code. Usable in Chrome and offline DOM fixtures.
export const googleSerpExpression = String.raw`(() => {
  const url = new URL(location.href);
  const google = h => ['google.com','www.google.com','google.com.hk','www.google.com.hk'].includes(h);
  if (url.hostname === 'consent.google.com' || document.querySelector('form[action*="consent.google.com"]'))
    return {kind:'consent',items:[]};
  if (url.pathname.startsWith('/sorry') || document.querySelector('form#captcha-form, #recaptcha, iframe[src*="recaptcha"][title]'))
    return {kind:'captcha',items:[]};
  if (!google(url.hostname) || url.pathname !== '/search') return {kind:'unknown',items:[]};
  const rso = document.querySelector('#rso');
  const items = [], seen = new Set();
  const clean = (s,n) => (s || '').replace(/\s+/g,' ').trim().slice(0,n);
  for (const h3 of Array.from(rso?.querySelectorAll('h3') || []).slice(0,200)) {
    const link = h3.closest('a[href]');
    if (!link || link.closest('#tads,#bottomads,[data-text-ad],[data-ad-client]')) continue;
    let target;
    try {
      target = new URL(link.getAttribute('href'),url.href);
      if (google(target.hostname) && target.pathname === '/url')
        target = new URL(target.searchParams.get('q') || target.searchParams.get('url') || '');
      if (!['http:','https:'].includes(target.protocol) || target.username || target.password) continue;
      if (google(target.hostname) || target.hostname.endsWith('.google.com') || target.hostname.endsWith('.google.com.hk') ||
          target.hostname === 'googleadservices.com' || target.hostname.endsWith('.googleadservices.com') ||
          target.hostname === 'doubleclick.net' || target.hostname.endsWith('.doubleclick.net')) continue;
      target.hash = '';
    } catch { continue; }
    if (seen.has(target.href)) continue;
    const title = clean(h3.textContent,300);
    if (!title) continue;
    let container = link.closest('.tF2Cxc');
    if (!container) {
      container = link;
      for (let i=0;i<6;i++) {
        const parent = container.parentElement;
        if (!parent || parent === rso || parent.querySelectorAll('h3').length > 1) break;
        container = parent;
        if (container.matches('[data-hveid],.MjjYud')) break;
      }
    }
    let snippet = '';
    for (const selector of ['.VwiC3b,.IsZvec,[data-sncf]', 'span,div']) {
      for (const el of container.querySelectorAll(selector)) {
        if (el.querySelector('h3,a[href]') || el.closest('a[href],nav')) continue;
        const text = clean(el.textContent,1001);
        if (!text || text === title || text.length > 1000 || text.includes('›') || /https?:\/\//.test(text.slice(0,60))) continue;
        if (selector === 'span,div' && text.length < 40) continue;
        snippet = text; break;
      }
      if (snippet) break;
    }
    seen.add(target.href); items.push({title,url:target.href,snippet:clean(snippet,1000)});
    if (items.length >= 100) break;
  }
  let nextStart;
  for (const link of document.querySelectorAll('#pnnext,a[rel="next"]')) {
    try {
      const next = new URL(link.getAttribute('href'),url.href), start = Number(next.searchParams.get('start'));
      if (next.origin === url.origin && next.pathname === '/search' && next.searchParams.get('q') === url.searchParams.get('q') &&
          next.searchParams.get('hl') === url.searchParams.get('hl') && Number.isInteger(start) && start % 10 === 0 &&
          start > Number(url.searchParams.get('start') || 0) && start <= 990) { nextStart = start; break; }
    } catch {}
  }
  if (items.length) return {kind:'results',items,nextStart};
  const text = clean(document.querySelector('#topstuff')?.textContent || document.querySelector('#search')?.textContent,8000);
  if (/did not match any documents|No results found|找不到和.*相符|未找到.*结果|没有找到.*结果/i.test(text)) return {kind:'empty',items:[]};
  return {kind:'unknown',items:[]};
})()`;
