import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { Defuddle } from 'defuddle/node';
import { parseHTML } from 'linkedom';
import { Readability } from '@mozilla/readability';
import TurndownService from 'turndown';
import gfmPlugin from 'turndown-plugin-gfm';

// No requests are allowed: all inputs are saved HTML or the controlled fixture.
const originalFetch = globalThis.fetch;
let attemptedNetwork = 0;
globalThis.fetch = async () => { attemptedNetwork++; throw new Error('Network disabled in extraction experiment'); };
const out = process.env.WEB_BENCH_OUTPUT_DIR
  ? pathToFileURL(path.resolve(process.env.WEB_BENCH_OUTPUT_DIR) + path.sep)
  : new URL('./results/', import.meta.url);
fs.mkdirSync(out, { recursive: true });
function dom(html, url) {
  const { document } = parseHTML(html);
  document.URL = url;
  document.styleSheets = [];
  document.defaultView.getComputedStyle = () => ({ display: '' });
  return document;
}
function read(html, url) {
  const document = dom(html, url);
  // Readability relies on browser URL resolution; linkedom does not provide it.
  let base = url;
  try { base = new URL(document.querySelector('base[href]')?.getAttribute('href') || url, url).href; } catch {}
  for (const element of document.querySelectorAll('[href], [src]')) {
    for (const key of ['href', 'src']) {
      const value = element.getAttribute(key);
      if (value) { try { element.setAttribute(key, new URL(value, base).href); } catch {} }
    }
  }
  const article = new Readability(document).parse();
  const td = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced' });
  td.use(gfmPlugin.gfm);
  return td.turndown(article?.content || '');
}
const text = 'Axiom controlled fixture contains enough connected article prose to exercise a reader extractor without relying on a live web page. ';
const fixture = `<!doctype html><html lang="en"><head><title>Axiom fixture</title></head><body><nav>OUTSIDE_NAV_MARKER</nav><main><article><h1>Axiom fixture</h1><p>${text.repeat(6)}</p><pre><code class="language-js">const answer = 42;\nconsole.log(answer);</code></pre><table><thead><tr><th>Name</th><th>Value</th></tr></thead><tbody><tr><td>alpha</td><td>42</td></tr></tbody></table><p><a href="../guide?q=1#anchor">Sibling guide</a> <a href="/reference">Root reference</a></p><p>${text.repeat(4)}</p></article></main><footer>OUTSIDE_FOOTER_MARKER</footer></body></html>`;
fs.writeFileSync(new URL('fixture.html', out), fixture);
const fixtures = [{ name: 'controlled-fixture', url: 'https://example.org/docs/page', html: fixture }];
// Optional corpus: filenames must be encodeURIComponent(originalURL) + '.html'.
const htmlDir = process.env.WEB_BENCH_HTML_DIR;
for (const file of htmlDir ? fs.readdirSync(htmlDir).filter(f => f.endsWith('.html')).sort() : []) {
  fixtures.push({ name: decodeURIComponent(file.replace(/\.html$/, '')), url: decodeURIComponent(file.replace(/\.html$/, '')), html: fs.readFileSync(path.join(htmlDir, file), 'utf8') });
}
const results = [];
for (const input of fixtures) {
  const entry = { name: input.name, url: input.url, inputBytes: Buffer.byteLength(input.html), inputSha256: crypto.createHash('sha256').update(input.html).digest('hex') };
  for (const which of ['defuddleNode', 'readabilityGfm']) {
    const start = performance.now();
    const md = which === 'defuddleNode' ? (await Defuddle(dom(input.html, input.url), input.url, { markdown: true, useAsync: false })).content : read(input.html, input.url);
    const elapsedMs = Math.round((performance.now() - start) * 10) / 10;
    entry[which] = { elapsedMs, outputBytes: Buffer.byteLength(md), outputSha256: crypto.createHash('sha256').update(md).digest('hex') };
    fs.writeFileSync(path.join(fileURLToPath(out), `${encodeURIComponent(input.name)}-${which}.md`), md);
    if (input.name === 'controlled-fixture') {
      const checks = {
        code: /```[^\n]*\nconst answer = 42;\nconsole\.log\(answer\);\n```/.test(md),
        table: /\|\s*Name\s*\|\s*Value\s*\|/.test(md) && /\|\s*:?-+/.test(md) && /\|\s*alpha\s*\|\s*42\s*\|/.test(md),
        siblingUrl: md.includes('https://example.org/guide?q=1#anchor'),
        rootUrl: md.includes('https://example.org/reference'),
        noNavigation: !md.includes('OUTSIDE_NAV_MARKER') && !md.includes('OUTSIDE_FOOTER_MARKER'),
      };
      entry[which].checks = checks;
      for (const [key, value] of Object.entries(checks)) assert.equal(value, true, `${which}: ${key}`);
    }
  }
  results.push(entry);
}
assert.equal(attemptedNetwork, 0);
fs.writeFileSync(new URL('summary.json', out), JSON.stringify({ node: process.version, packageVersions: { defuddle: '0.19.6', readability: '0.6.0', turndown: '7.2.4', gfm: '1.0.2', linkedom: '0.18.14' }, attemptedNetwork, fixtureAssertions: 10, note: 'Single run on saved static HTML; elapsed includes DOM parse and conversion. Not a quality ranking or benchmark of network latency.', results }, null, 2) + '\n');
globalThis.fetch = originalFetch;
console.log(JSON.stringify(results, null, 2));
