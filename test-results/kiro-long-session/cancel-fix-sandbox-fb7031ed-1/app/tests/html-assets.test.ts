import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync, linkSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "./temporary.js";
import { htmlResources } from "../src/server/html-preview.js";
import { cssResourceTags, htmlResourceLinks, htmlResourceTags } from "../src/shared/html-preview.js";

const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWZkAAAAASUVORK5CYII=", "base64");
test("HTML asset scanner includes real image/style references, not comments, JS, templates or CSS strings", () => {
  const text = `<!--<img src="no.png">--><script>const x='<img src="no.png">';</script><template><img src="no.png"><style>div{background:url(no.png)}</style></template><textarea><img src="no.png"></textarea>
    <style>/*url(no.png)*/ p:before{content:"url(no.png)"} div{background:url('bg.png')} @font-face{src:url(font.woff2)}</style>
    <img src="p&#105;c.png"><video poster="poster.jpg"></video><div style="background:url(inline.png)"></div><svg><image href="icon.svg"/></svg><img src="data:image/png;base64,abc">`;
  assert.deepEqual(htmlResourceLinks(text), [
    { href: "bg.png", kind: "image" }, { href: "font.woff2", kind: "font" }, { href: "pic.png", kind: "image" },
    { href: "poster.jpg", kind: "image" }, { href: "inline.png", kind: "image" }, { href: "icon.svg", kind: "image" },
  ]);
  assert.deepEqual(htmlResourceTags(text).map(tag => text.slice(tag.start, tag.end)), ["url('bg.png')", "url(font.woff2)", 'src="p&#105;c.png"', 'poster="poster.jpg"', 'url(inline.png)', 'href="icon.svg"']);
  assert.deepEqual(cssResourceTags('a{fill:url(#local);background:url(data:image/png;base64,abc)}'), []);
});

test("inline style decodes entities before CSS parsing and preserves original replacement ranges", () => {
  for (const quote of ["&quot;", "&#34;", "&#x22;"]) {
    const raw = `url(${quote}pic.png${quote})`;
    const html = `<div style="color:red;background:${raw};width:20px"></div>`;
    const tags = htmlResourceTags(html);
    assert.equal(tags.length, 1); assert.equal(tags[0].href, "pic.png");
    assert.equal(html.slice(tags[0].start, tags[0].end), raw);
  }
  const html = '<div style="&#47;*url(no.png)*&#47;background:url(&Tab;&quot;pic.png&quot;&Tab;)"></div>';
  assert.deepEqual(htmlResourceLinks(html), [{ href: "pic.png", kind: "image" }]);
  assert.equal(html.slice(htmlResourceTags(html)[0].start, htmlResourceTags(html)[0].end), 'url(&Tab;&quot;pic.png&quot;&Tab;)');
});

test("HTML assets embed signatures, CSS-relative images/fonts and static SVG without expanding unsafe paths", async () => {
  const root = mkdtempSync(join(tmpdir(), "axiom-html-assets-"));
  const directory = join(root, "page"); mkdirSync(directory); mkdirSync(join(directory, "styles"));
  const font = readFileSync(new URL("./fixtures/fonts/inter-latin.woff2", import.meta.url));
  let authorized = 0;
  const read = (text: string) => htmlResources(join(directory, "index.html"), text, () => { authorized++; }, AbortSignal.timeout(10000));
  try {
    writeFileSync(join(directory, "pic.png"), png);
    writeFileSync(join(directory, "styles", "pic.png"), png);
    writeFileSync(join(directory, "styles", "font.woff2"), font);
    writeFileSync(join(directory, "styles", "page.css"), "div{background:url(pic.png)} @font-face{font-family:demo;src:url('font.woff2')}");
    writeFileSync(join(directory, "icon.svg"), '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10" fill="red"/></svg>');
    writeFileSync(join(directory, "unsafe.svg"), '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    writeFileSync(join(directory, "fake.png"), "secret plain text");
    writeFileSync(join(directory, "fake.woff2"), "secret plain text");
    writeFileSync(join(root, "outside.png"), png);
    writeFileSync(join(directory, ".hidden.png"), png);
    writeFileSync(join(directory, "large.png"), Buffer.alloc(2 * 1024 * 1024 + 1));
    symlinkSync(join(root, "outside.png"), join(directory, "symbolic.png"));
    linkSync(join(root, "outside.png"), join(directory, "hard.png"));
    const result = await read('<link rel="stylesheet" href="styles/page.css"><img src="pic.png"><img src="icon.svg">');
    assert.equal(result.resources.length, 3);
    const css = result.resources[0].text!;
    assert.ok(css.includes(`url(data:image/png;base64,${png.toString("base64")})`));
    assert.ok(css.includes(`url(data:font/woff2;base64,${font.toString("base64")})`));
    assert.equal(result.resources[1].dataUrl, `data:image/png;base64,${png.toString("base64")}`);
    assert.match(result.resources[2].dataUrl!, /^data:image\/svg\+xml;base64,/);
    assert.equal(result.resourceNotice, undefined);
    assert.ok(authorized >= 6);
    const blocked = ["../outside.png", "%2e%2e/outside.png", ".hidden.png", "symbolic.png", "hard.png", "fake.png", "unsafe.svg", "large.png", "https://example.com/pic.png", "/outside.png", "missing.png"];
    const rejected = await read(blocked.map(src => `<img src="${src}">`).join("") + '<style>@font-face{src:url(fake.woff2)}</style>');
    assert.equal(rejected.resources.length, 0);
    assert.match(rejected.resourceNotice!, /^12 个页面资源未加载/);
    const controller = new AbortController(); controller.abort();
    await assert.rejects(htmlResources(join(directory, "index.html"), '<img src="pic.png">', () => {}, controller.signal));
    await assert.rejects(htmlResources(join(directory, "index.html"), '<img src="pic.png">', () => { throw new Error("revoked"); }, AbortSignal.timeout(10000)), /revoked/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("srcset candidates and recursive CSS imports retain media suffixes within the root", async () => {
  const source = '<img srcset="data:image/png;base64,abc 1x, a.png?a=1&amp;b=2 2x, b.png 3x"><source srcset="c.png 480w, d.png 960w">';
  const tags = htmlResourceTags(source); assert.deepEqual(tags.map(t => t.href), ["a.png?a=1&b=2", "b.png", "c.png", "d.png"]);
  assert.equal(source.slice(tags[0].start, tags[0].end), "a.png?a=1&amp;b=2"); assert.ok(tags.every(t => t.urlOnly));
  const root = mkdtempSync(join(tmpdir(), "axiom-css-imports-")); mkdirSync(join(root, "css"));
  try {
    writeFileSync(join(root, "pic.png"), png);
    writeFileSync(join(root, "css", "main.css"), '@import "../base.css" screen and (min-width:1px); div{background:url(../pic.png)}');
    writeFileSync(join(root, "base.css"), '@import "css/main.css"; h1{color:red}');
    const result = await htmlResources(join(root, "index.html"), '<link rel="stylesheet" href="css/main.css">', () => {}, AbortSignal.timeout(5000));
    assert.match(result.resources[0].text!, /@import url\(data:text\/css;base64,/); assert.match(result.resources[0].text!, /screen and \(min-width:1px\)/); assert.match(result.resources[0].text!, /data:image\/png/); assert.match(result.resourceNotice!, /未加载/);
    writeFileSync(join(root, "base.css"), "/*" + "x".repeat(500000) + "*/");
    writeFileSync(join(root, "css", "main.css"), '@import "../base.css";'.repeat(20000));
    const bounded = await htmlResources(join(root, "index.html"), '<link rel="stylesheet" href="css/main.css">', () => {}, AbortSignal.timeout(5000));
    assert.ok(bounded.resources[0].text!.length <= 12 * 1024 * 1024); assert.match(bounded.resourceNotice!, /未加载/);
    const controller = new AbortController(); const pending = htmlResources(join(root, "index.html"), '<link rel="stylesheet" href="css/main.css">', () => {}, controller.signal);
    setImmediate(() => controller.abort()); await assert.rejects(pending);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("HTML asset count and aggregate bytes stay bounded; repeated references are deduplicated", async () => {
  const root = mkdtempSync(join(tmpdir(), "axiom-html-budget-"));
  const read = (text: string) => htmlResources(join(root, "index.html"), text, () => {}, AbortSignal.timeout(10000));
  try {
    for (let i = 0; i < 50; i++) writeFileSync(join(root, `${i}.png`), png);
    const result = await read(Array.from({ length: 50 }, (_, i) => `<img src="${i}.png">`).join(""));
    assert.equal(result.resources.length, 48); assert.match(result.resourceNotice!, /^2 个/);
    assert.equal((await read('<img src="0.png">'.repeat(100))).resources.length, 1);
    for (let i = 0; i < 5; i++) writeFileSync(join(root, `${i}.png`), Buffer.concat([png, Buffer.alloc(2 * 1024 * 1024 - png.length)]));
    const large = await read(Array.from({ length: 5 }, (_, i) => `<img src="${i}.png">`).join(""));
    assert.equal(large.resources.length, 4); assert.match(large.resourceNotice!, /^1 个/);
    writeFileSync(join(root, "repeated.css"), `div{background:${Array.from({ length: 10 }, () => "url(0.png)").join(",")}}`);
    const expanded = await read('<link rel="stylesheet" href="repeated.css">');
    assert.ok(expanded.resources[0].text!.length < 12 * 1024 * 1024);
    assert.match(expanded.resourceNotice!, /页面资源未加载/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
