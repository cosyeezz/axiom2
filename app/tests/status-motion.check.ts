import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { chromium } from "playwright";
import { BubbleLoadingIcon, FoldIcon, PulseRingsIcon } from "../src/client/StatusIcons.js";
import { RunningDots } from "../src/client/chat/RunningDots.js";
import { CacheUsageIcon } from "../src/client/chat/UsageIcons.js";

import { CompressionProgressIcon, ContextMemoryIcon, BatchProgressIcon } from "../src/client/DataIcons.js";
// Render production components. Inspect visible values and actual timelines;
// numeric fill levels must stay fixed while activity indicators animate.
const markup = renderToStaticMarkup;
const browser = await chromium.launch({ executablePath: process.env.AXIOM_TEST_BROWSER });
const results: unknown[] = [];
try {
  const page = await browser.newPage({ viewport: { width: 900, height: 600 } });
  await page.setContent(`<main style="padding:60px;display:flex;gap:32px;align-items:center">
    <div id="bubble">${markup(createElement(BubbleLoadingIcon))}</div>
    <div id="dots">${markup(createElement(RunningDots, { className: "running-dots" }))}</div>
    <div id="rings">${markup(createElement(PulseRingsIcon))}</div>
    <div id="fold">${markup(createElement(FoldIcon))}</div>
    <div id="cache">${markup(createElement(CacheUsageIcon, { active: true, percent: 75 }))}</div>
    <div id="compression">${markup(createElement(CompressionProgressIcon, { state: "running", phase: "applying" }))}</div>
    <div id="progress">${markup(createElement(ContextMemoryIcon, { percent: 60 }))}</div>
    <div id="batch">${markup(createElement(BatchProgressIcon, { states: ["completed", "failed", "running"], label: "batch" }))}</div>
    <div id="idle-cache">${markup(createElement(CacheUsageIcon, { active: false, percent: 75 }))}</div>
    <span id="task" class="execution-pulse"></span>
    <div id="file" class="file-loading"></div>
    <button class="cost-refresh" aria-busy="true"><svg id="cost" viewBox="0 0 24 24"><path d="M20 7v5h-5M4 17v-5h5" /></svg></button>
    <span id="update" class="connect-update-pulse"></span>
    <button id="send" class="send is-running"><svg viewBox="0 0 24 24"><rect x="6" y="6" width="12" height="12" rx="2"/></svg></button>
  </main>`);
  for (const file of ["tokens", "workbench", "chat", "costs", "file-preview", "connect", "action-icons", "icon-geometry", "mobile", "data-icons"])
    await page.addStyleTag({ content: readFileSync(`src/client/styles/${file}.css`, "utf8") });
  for (const reducedMotion of ["no-preference", "reduce"] as const) {
    await page.emulateMedia({ reducedMotion });
    await page.mouse.move(0, 0);
    const result = await page.evaluate(async () => {
      const ids = ["task", "file", "cost", "update", "send", "send-glow"];
      const svgIds = ["bubble", "dots", "rings", "fold", "cache", "compression", "batch"];
      const svgs = svgIds.map((id) => document.querySelector<SVGSVGElement>(`#${id} svg`)!);
      for (const svg of svgs) svg.setCurrentTime(0.1);
      const samples = [];
      for (let sample = 0; sample < 2; sample++) {
        const start = performance.now();
        do { await new Promise<void>((resolve) => requestAnimationFrame(() => resolve())); }
        while (performance.now() - start < (sample ? 390 : 30));
        samples.push({
          svg: svgs.map((svg, i) => ({ id: svgIds[i], time: svg.getCurrentTime(), values: [...svg.querySelectorAll("circle, g, path")].map((node) => {
            const style = getComputedStyle(node);
            const shape = node as SVGGraphicsElement;
            return [node instanceof SVGCircleElement ? node.r.animVal.value : 0, style.opacity, style.transform, shape.transform?.animVal.numberOfItems ? shape.transform.animVal.getItem(0).matrix.e : 0, shape.transform?.animVal.numberOfItems ? shape.transform.animVal.getItem(0).matrix.f : 0];
          }) })),
          css: ids.map((id) => {
            const node = document.getElementById(id === "send-glow" ? "send" : id)!;
            const pseudo = id === "task" || id === "send-glow" ? "::after" : undefined;
            const style = getComputedStyle(node, pseudo);
            return { id, name: style.animationName, transform: style.transform, opacity: style.opacity, duration: style.animationDuration };
          }),
        });
      }
      return { before: samples[0], after: samples[1] };
    });
    for (let i = 0; i < result.after.svg.length; i++) {
      const before = result.before.svg[i], after = result.after.svg[i];
      assert.ok(after.time > before.time + .2, `${reducedMotion}: ${after.id} timeline advances`);
      assert.notDeepEqual(after.values, before.values, `${reducedMotion}: ${after.id} visibly changes`);
    }
    for (let i = 0; i < result.after.css.length; i++) {
      const before = result.before.css[i], after = result.after.css[i];
      assert.notEqual(after.name, "none", `${reducedMotion}: ${after.id} has animation`);
      assert.ok(after.transform !== before.transform || after.opacity !== before.opacity, `${reducedMotion}: ${after.id} visibly changes`);
    }
    assert.equal(await page.locator("#idle-cache animate").count(), 0, "completed work has no looping cache timeline");
    assert.equal(await page.locator("#idle-cache .cache-outline").evaluate(node => getComputedStyle(node).opacity), "1");
    assert.equal(await page.locator("#cache .data-level").getAttribute("height"), "11.25", "activity never changes the measured 75% fill");
    assert.equal(await page.locator("#progress .data-filled").count(), 6, "context segments retain the measured value");
    assert.equal(await page.locator("#progress .data-activity, #cache .data-activity").count(), 0, "context and cache omit redundant activity dots");
    assert.equal(await page.locator("#progress animate, #progress animateTransform").count(), 0, "context capacity stays static");
    results.push({ reducedMotion, ...result });
  }
  // Deliberate interaction policy: a focused stop button stays steady for targeting.
  await page.locator("#send").focus();
  assert.equal(await page.locator("#send").evaluate(node => getComputedStyle(node).animationName), "none");
  await page.locator("#send").evaluate(node => (node as HTMLElement).blur());
  await page.locator(".cost-refresh").evaluate(node => node.setAttribute("aria-busy", "false"));
  await page.locator("#send").evaluate(node => node.classList.remove("is-running"));
  for (const id of ["cost", "send"]) assert.equal(await page.locator(`#${id}`).evaluate(node => getComputedStyle(node).animationName), "none", `${id}: work ending removes animation`);
  mkdirSync("test-results/status-motion", { recursive: true });
  writeFileSync("test-results/status-motion/results.json", JSON.stringify(results, null, 2));
  console.log("PASS: 7 real SVG components and 6 CSS indicators visibly advance in reduce/no-preference; context and cache have no activity dots; context, idle cache and ended operations are static; measured levels and stop focus policy are preserved.");
} finally { await browser.close(); }
