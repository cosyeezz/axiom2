// Render real components in Chromium, including SVG timelines and product CSS.
// Run: node --import tsx tests/task-spinner.check.ts
import assert from "node:assert/strict";
import { mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { build } from "esbuild";
import { chromium } from "playwright";

const statuses = ["queued", "starting", "running", "stopping", "completed", "failed", "cancelled", "interrupted"];
const bundle = await build({
  stdin: { resolveDir: resolve("."), loader: "tsx", contents: `
    import { createElement as h } from 'react';
    import { createRoot } from 'react-dom/client';
    import { TaskState } from './src/client/tasks/TaskCards.tsx';
    import { PulseRingsIcon, FoldIcon } from './src/client/StatusIcons.tsx';
    import { defaultBudgets } from './src/shared/tasks.ts';
    const root = createRoot(document.getElementById('icons'));
    window.renderIcons = (completed = false) => root.render(h('main', null,
      ...${JSON.stringify(statuses)}.map(status => h('button', { className: 'subagent', id: status, key: status },
        h(TaskState, { task: { id: status, status: completed && status === 'running' ? 'completed' : status,
          workspaceId: 'workspace', parentSessionId: 'parent', sessionId: 'child', anchor: 'message',
          description: '检查子任务', runId: 'run', createdAt: 0, budgets: defaultBudgets, results: [], error: null } }))),
      ...[0, 1].map(index => h('p', { className: 'history-item session-title-line', key: 'title-' + index },
        h(PulseRingsIcon, { className: 'session-state running', label: '运行中' }), '进行中',
        h(PulseRingsIcon, { className: 'session-state unread', label: '未读' }), '待阅读')),
      h('span', { className: 'compaction-icon' }, h(FoldIcon))));
    window.renderIcons();
  ` },
  bundle: true, write: false, format: "iife", platform: "browser",
  loader: { ".svg": "text", ".css": "empty" }, define: { "process.env.NODE_ENV": '"production"' },
});
const css = ["tokens", "workbench", "thread-navigation"].map(name => readFileSync(new URL(`../src/client/styles/${name}.css`, import.meta.url), "utf8")).join("\n");
mkdirSync("test-results/status-icons", { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.AXIOM_TEST_BROWSER });
try {
  const page = await browser.newPage({ viewport: { width: 600, height: 1000 } });
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  for (const reducedMotion of ["no-preference", "reduce"] as const) {
    await page.emulateMedia({ reducedMotion });
    await page.setContent(`<style>${css}</style><div id="icons" style="padding:24px"></div>`);
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    await page.locator("#running .bubble-loading").waitFor();
    for (const status of statuses) {
      const active = ["queued", "starting", "running", "stopping"].includes(status);
      const icon = page.locator(`#${status} svg`);
      assert.equal(await icon.locator("animate").count(), active ? 8 : 0, `${status}, ${reducedMotion}`);
      if (active) {
        const radii = await icon.evaluate(node => {
          const svg = node as SVGSVGElement;
          svg.pauseAnimations();
          svg.setCurrentTime(0.2);
          const first = [...svg.querySelectorAll("circle")].map(circle => circle.r.animVal.value);
          svg.setCurrentTime(0.7);
          const second = [...svg.querySelectorAll("circle")].map(circle => circle.r.animVal.value);
          svg.unpauseAnimations();
          return { first, second, stroke: getComputedStyle(svg).stroke };
        });
        assert.notDeepEqual(radii.first, radii.second, "fixed-position bubbles change size");
        assert.ok(radii.first.some(r => r > 0) && radii.second.some(r => r > 0));
        assert.equal(radii.stroke, "none", "global outline styles do not add strokes");
      }
      assert.equal(await icon.evaluate(node => getComputedStyle(node).transform), "none");
      assert.equal(await page.locator(`#${status} .agent-state-label`).evaluate(node => getComputedStyle(node).transform), "none");
    }
    const colors = await page.locator('.session-state').evaluateAll(nodes => nodes.map(node => getComputedStyle(node).color));
    assert.notEqual(colors[0], colors[1], 'running and unread are distinguished by color');
    assert.equal(colors[0], colors[2]);
    assert.equal(colors[1], colors[3]);
    await page.locator('.fold-icon').scrollIntoViewIfNeeded();
    // Sample live frames across multiple fold animation cycles.
    const frames: unknown[][] = [];
    for (const delay of [350, 550, 1200, 1400]) {
      await page.waitForTimeout(delay);
      frames.push(await page.locator(".fold-icon").evaluateAll(nodes => nodes.map(svg =>
        [...svg.querySelectorAll("path,rect")].map(shape => ({
          transform: getComputedStyle(shape).transform, opacity: getComputedStyle(shape).opacity,
          x: shape instanceof SVGRectElement ? shape.x.animVal.value : null,
          y: shape instanceof SVGRectElement ? shape.y.animVal.value : null,
        })))));
    }
    for (let index = 0; index < frames[0].length; index++) {
      assert.ok(new Set(frames.map(frame => JSON.stringify(frame[index]))).size > 1, `icon ${index} animates in ${reducedMotion}`);
      assert.notDeepEqual(frames[2][index], frames[3][index], `icon ${index} continues beyond its first cycle`);
    }
    for (const icon of await page.locator(".pulse-rings-multiple").all()) {
      assert.equal(await icon.evaluate(node => getComputedStyle(node).width), "8px");
      const phases = [];
      for (const time of [0, 1, 2, 3, 4, 4.5, 5, 5.5, 5.99, 6, 6.01]) {
        phases.push(await icon.evaluate((node, time) => {
          const svg = node as SVGSVGElement;
          svg.pauseAnimations();
          svg.setCurrentTime(time);
          return {
            radius: svg.querySelector<SVGCircleElement>(".unread-solid-dot")!.r.animVal.value,
            rings: [...svg.querySelectorAll("g > g")].map(ring => getComputedStyle(ring).transform),
          };
        }, time));
      }
      assert.equal(phases[0].radius, 0);
      assert.ok(phases[1].radius > 0 && phases[1].radius < 9, "rings fill gradually during the first two seconds");
      assert.equal(phases[2].radius, 9);
      assert.deepEqual(phases[2], phases[3], "solid dot stays still during its hold");
      assert.deepEqual(phases[2], phases[4], "solid dot holds until four seconds");
      assert.ok(phases[5].radius < 9 && phases[5].radius > phases[6].radius && phases[6].radius > phases[7].radius && phases[7].radius > 0, "solid dot shrinks gradually over the last two seconds");
      assert.ok(Math.abs(phases[6].radius - phases[1].radius) < 0.001, "reverse midpoint mirrors the filling midpoint");
      assert.deepEqual(phases[6].rings, phases[1].rings, "rings reverse along the same path");
      assert.deepEqual(phases[9], phases[0], "six-second cycle returns to its starting shape");
      assert.ok(phases[8].radius < 0.05 && phases[10].radius < 0.05, "loop boundary stays continuous");
      await icon.evaluate(node => (node as SVGSVGElement).setCurrentTime(3));
    }
    const title = await page.locator(".session-state.running").first().elementHandle();
    await page.evaluate(() => (window as any).renderIcons(true));
    await page.locator('#running .agent-state[data-state="completed"]').waitFor();
    assert.equal(await page.locator("#running animate").count(), 0, "completion unmounts the loading animation");
    assert.equal(await title!.evaluate(node => node === document.querySelector(".session-state.running")), true, "updates retain title SVG identity");
    await page.screenshot({ path: `test-results/status-icons/${reducedMotion}.png` });
  }
  assert.deepEqual(errors, []);
  console.log("PASS: official bubble loading, running/unread rings distinguished by color, fill over 2s, hold solid for 2s and reverse over 2s at 8px, animated fold, normal/reduced motion, stable labels and state transitions.");
} finally {
  await browser.close();
}
