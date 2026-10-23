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
    import { SessionStatusIcon, FoldIcon } from './src/client/StatusIcons.tsx';
    import { defaultBudgets } from './src/shared/tasks.ts';
    const root = createRoot(document.getElementById('icons'));
    window.renderIcons = (completed = false) => root.render(h('main', null,
      ...${JSON.stringify(statuses)}.map(status => h('button', { className: 'subagent', id: status, key: status },
        h(TaskState, { task: { id: status, status: completed && status === 'running' ? 'completed' : status,
          workspaceId: 'workspace', parentSessionId: 'parent', sessionId: 'child', anchor: 'message',
          description: '检查子任务', runId: 'run', createdAt: 0, budgets: defaultBudgets, results: [], error: null } }))),
      ...[0, 1].map(index => h('p', { className: 'history-item session-title-line', key: 'title-' + index },
        h(SessionStatusIcon, { state: 'running', label: '运行中' }), '进行中',
        h(SessionStatusIcon, { state: 'unread', label: '未读' }), '待阅读')),
      h('span', { className: 'compaction-icon' }, h(FoldIcon))));
    window.renderIcons();
  ` },
  bundle: true, write: false, format: "iife", platform: "browser",
  loader: { ".svg": "text", ".css": "empty" }, define: { "process.env.NODE_ENV": '"production"' },
});
const css = ["tokens", "workbench", "thread-navigation", "icon-geometry", "task-calls"].map(name => readFileSync(new URL(`../src/client/styles/${name}.css`, import.meta.url), "utf8")).join("\n");
const sprite = readFileSync(new URL("../src/client/icons.svg", import.meta.url), "utf8");
mkdirSync("test-results/status-icons", { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.AXIOM_TEST_BROWSER });
try {
  const page = await browser.newPage({ viewport: { width: 600, height: 1000 } });
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  for (const reducedMotion of ["no-preference", "reduce"] as const) {
    await page.emulateMedia({ reducedMotion });
    await page.setContent(`<style>${css}</style>${sprite}<div id="icons" style="padding:24px"></div>`);
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    await page.locator("#running .task-running-icon").waitFor();
    for (const status of statuses) {
      const active = ["starting", "running", "stopping"].includes(status);
      const icon = page.locator(`#${status} svg`);
      const expected = active ? "subagent-running" : status === "queued" ? "hourglass" : status === "completed" ? "subagent-completed" : "subagent-ended";
      assert.equal(await icon.locator("use").getAttribute("href"), `#i-${expected}`);
      assert.equal(await icon.evaluate(node => getComputedStyle(node).animationName), active ? "task-icon-spin" : "none", `${status}, ${reducedMotion}`);
      if (active) {
        const frames = await icon.evaluate(node => {
          const animation = node.getAnimations()[0];
          animation.pause(); animation.currentTime = 0;
          const first = getComputedStyle(node).transform;
          animation.currentTime = 350;
          const second = getComputedStyle(node).transform;
          animation.play();
          return { first, second };
        });
        assert.notEqual(frames.first, frames.second, "only the Tabler loader rotates");
      } else {
        assert.equal(await icon.evaluate(node => getComputedStyle(node).transform), "none", "queued and terminal icons remain static");
      }
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
    const gradientIds = await page.locator('.session-state radialGradient').evaluateAll(nodes => nodes.map(node => node.id));
    assert.equal(new Set(gradientIds).size, 2, 'each unread icon has an independent gradient ID');
    for (const icon of await page.locator('.session-state').all()) {
      assert.equal(await icon.evaluate(node => getComputedStyle(node).width), '8px');
      assert.equal(await icon.locator('animate, animateTransform').count(), 0, 'status markers never shrink or expand');
      const running = await icon.evaluate(node => node.classList.contains('running'));
      assert.equal(await icon.locator('.session-state-dot').getAttribute('r'), running ? '9' : '8');
      if (running) {
        assert.equal(await icon.locator('.session-state-halo').count(), 0);
        assert.equal(await icon.evaluate(node => node.getAnimations({ subtree: true }).length), 0, 'green point stays static');
        continue;
      }
      const halo = icon.locator('.session-state-halo');
      assert.equal(await halo.getAttribute('r'), '24');
      assert.equal(await halo.getAttribute('fill'), `url(#${await icon.locator('radialGradient').getAttribute('id')})`);
      const phases = await halo.evaluate((node, reduced) => {
        const animation = node.getAnimations()[0];
        if (!reduced) animation.pause();
        return [0, 750, 1500, 2250, 3000].map(time => {
          if (!reduced) animation.currentTime = time;
          return { opacity: Number(getComputedStyle(node).opacity), transform: getComputedStyle(node).transform,
            radius: (node as SVGCircleElement).r.animVal.value };
        });
      }, reducedMotion === 'reduce');
      assert.ok(phases.every(phase => phase.radius === 24 && phase.transform === 'none'), 'halo geometry never changes');
      if (reducedMotion === 'reduce') {
        assert.ok(phases.every(phase => phase.opacity === .65), 'reduced motion keeps a steady halo');
      } else {
        assert.equal(phases[0].opacity, .25);
        assert.ok(phases[1].opacity > .25 && phases[1].opacity < 1);
        assert.equal(phases[2].opacity, 1);
        assert.equal(phases[4].opacity, .25);
      }
      assert.equal(await icon.locator('.session-state-dot').evaluate(node => getComputedStyle(node).opacity), '1', 'blue core is always visible');
    }
    const title = await page.locator(".session-state.running").first().elementHandle();
    await page.evaluate(() => (window as any).renderIcons(true));
    await page.locator('#running .agent-state[data-state="completed"]').waitFor();
    assert.equal(await page.locator("#running .task-running-icon").count(), 0, "completion removes the loading animation");
    assert.equal(await page.locator('#running svg').evaluate(node => node.getAnimations().length), 0);
    assert.equal(await title!.evaluate(node => node === document.querySelector(".session-state.running")), true, "updates retain title SVG identity");
    await page.screenshot({ path: `test-results/status-icons/${reducedMotion}.png` });
  }
  assert.deepEqual(errors, []);
  console.log("PASS: selected subagent icons, rotating Tabler loader, static queued/terminal states, static green session dots and fixed-size blue halos at 8px, unique gradients, 3-second opacity cycle, animated fold, normal/reduced motion, stable labels and state transitions.");
} finally {
  await browser.close();
}
