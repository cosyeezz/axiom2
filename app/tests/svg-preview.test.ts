import assert from "node:assert/strict";
import { test } from "node:test";
import { staticSvg } from "../src/server/svg-preview.js";
const safe = (body: string) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">${body}</svg>`;
test("SVG previews accept static icons, Chinese labels and local gradients", () => {
  for (const svg of [safe('<path d="M1 2h20" fill="none" stroke="currentColor"/>'), safe('<text x="2" y="20">图标 &amp; 候选</text>'), safe('<defs><linearGradient id="a"><stop offset="0" stop-color="#fff"/></linearGradient></defs><rect width="24" height="24" fill="url(#a)"/>'), '<?xml version="1.0" encoding="UTF-8"?>'+safe('<g><circle cx="12" cy="12" r="8"/></g>')]) assert.equal(staticSvg(Buffer.from(svg)), true, svg);
});
test("SVG previews reject executable, external, malformed and oversized content", () => {
  for (const svg of [safe('<script>alert(1)</script>'), safe('<foreignObject><p>html</p></foreignObject>'), safe('<image href="https://example.com/x"/>'), safe('<use href="file:///etc/passwd"/>'), safe('<path onload="alert(1)"/>'), safe('<style>@import "https://example.com";</style>'), safe('<path style="fill:red"/>'), safe('<path fill="url(https://example.com/x)"/>'), safe('<path fill="url(&#104;ttps://example.com/x)"/>'), safe('<animate attributeName="href"/>'), '<!DOCTYPE svg [<!ENTITY x SYSTEM "file:///etc/passwd">]>'+safe('<text>&x;</text>'), safe('<text>&#60;script&#62;</text>'), safe('<g></path>'), safe('')+safe(''), safe('<path d="x" d="y"/>'), safe('<path xmlns="http://evil.test"/>'), safe('<path/')]) assert.equal(staticSvg(Buffer.from(svg)), false, svg);
  assert.equal(staticSvg(Buffer.from(safe('x'.repeat(1024 * 1024)))), false);
  assert.equal(staticSvg(Buffer.from([0xff, 0xfe])), false);
});
