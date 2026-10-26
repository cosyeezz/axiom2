import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { cacheRatio, validRatio, TaskProgressIcon, BatchProgressIcon, CompressionProgressIcon, ContextMemoryIcon, CacheDataIcon } from "../src/client/DataIcons.js";

test("ratios distinguish unknown, valid zero and capacity overflow", () => {
  assert.equal(validRatio(0, 100), 0); assert.equal(validRatio(150, 100), 150);
  for (const [value, total] of [[null, 100], [0, 0], [-1, 100], [1, Infinity], [NaN, 100]] as const) assert.equal(validRatio(value, total), null);
  assert.equal(cacheRatio({ input: 50, cacheRead: 25, cacheWrite: 25 }), 25);
  assert.equal(cacheRatio({ input: 1, cacheRead: 0, cacheWrite: 0 }), 0);
  assert.equal(cacheRatio({ input: 0, cacheRead: 0, cacheWrite: 0 }), null);
  assert.equal(cacheRatio({ input: -1, cacheRead: 1, cacheWrite: 0 }), null);
  assert.equal(cacheRatio({ input: Infinity, cacheRead: 1, cacheWrite: 0 }), null);
});
test("unknown task never fills segments; conflicts retain warning; ended mixed batches retain failed/stopped marks", () => {
  const unknown = renderToStaticMarkup(createElement(TaskProgressIcon, { percent: null }));
  assert.doesNotMatch(unknown, /class="data-filled"/); assert.match(unknown, /data-unknown/);
  const conflict = renderToStaticMarkup(createElement(TaskProgressIcon, { percent: null, error: true }));
  assert.match(conflict, /triangle-alert/); assert.doesNotMatch(conflict, /#i-check/);
  const batch = renderToStaticMarkup(createElement(BatchProgressIcon, { states: ["completed", "failed", "cancelled"], label: "batch" }));
  assert.equal((batch.match(/class="data-success"/g) ?? []).length, 1);
  assert.match(batch, /data-error/); assert.match(batch, /data-stopped/); assert.doesNotMatch(batch, /<animate/);
  const resumed = renderToStaticMarkup(createElement(BatchProgressIcon, { states: ["queued", "failed", "cancelled"], label: "batch" }));
  assert.doesNotMatch(resumed, /data-success/);
});
test("context capacity and task thirds remain independent; only 100% lights all three bars", () => {
  for (const [taskPercent, bars] of [[null, 0], [0, 0], [30, 0], [100 / 3, 1], [60, 1], [200 / 3, 2], [90, 2], [99.99, 2], [100, 3], [101, 0], [NaN, 0]] as const) {
    const svg = renderToStaticMarkup(createElement(ContextMemoryIcon, { percent: 50, taskPercent }));
    assert.equal((svg.match(/class="memory-progress-lit"/g) ?? []).length, bars, String(taskPercent));
    assert.equal((svg.match(/class="data-filled context-ring"/g) ?? []).length, 1);
    assert.match(svg, /d="M10 1\.5A8\.5 8\.5 0 0 1 10[^ ]* 18\.5"/);
    assert.doesNotMatch(svg, /stroke-dasharray|<svg[^>]*memory-progress-bars/);
    assert.doesNotMatch(svg, /<animate|#i-check/);
  }
  for (const percent of [0, 49.99, 50, 100, null, NaN, -1]) {
    const svg = renderToStaticMarkup(createElement(CacheDataIcon, { percent, active: false }));
    assert.equal(svg.includes('data-icon-cache-low'), percent != null && Number.isFinite(percent) && percent >= 0 && percent < 50, String(percent));
  }
});

test("chapter task states animate only the three original checklist strokes, independently of capacity", () => {
  for (const state of ["未开始", "进行中", "已完成", "等待", "失败", "已放弃", "阻塞"] as const) {
    const svg = renderToStaticMarkup(createElement(ContextMemoryIcon, { percent: 95, taskPercent: 100, taskState: state }));
    assert.match(svg, /data-icon-capacity-warning/);
    assert.ok(svg.includes(`data-state="${state === "阻塞" ? "等待" : state}"`));
    assert.doesNotMatch(svg, /data-progress=|memory-progress-lit|memory-progress-pending/);
    assert.equal((svg.match(/class="memory-progress-state"/g) ?? []).length, 3);
    assert.equal((svg.match(/<animate /g) ?? []).length, state === "进行中" ? 3 : 0);
    assert.equal((svg.match(/<path /g) ?? []).length, 5, "only the context ring and the original checklist geometry");
  }
});

test("cache color thresholds govern breathing only during active work", () => {
  for (const [percent, tone] of [[0, "danger"], [70, "danger"], [70.01, "warning"], [90, "warning"], [90.01, "success"], [100, "success"], [null, "unknown"], [NaN, "unknown"]] as const) {
    for (const active of [false, true]) {
      const svg = renderToStaticMarkup(createElement(CacheDataIcon, { percent, active }));
      assert.ok(svg.includes(`data-tone="${tone}"`), String(percent));
      assert.equal(svg.includes("<animate"), active && tone !== "success", `${percent}: active=${active}`);
    }
  }
});

test("compression waits for applied confirmation; terminal states remove activity", () => {
  const waiting = renderToStaticMarkup(createElement(CompressionProgressIcon, { state: "running", phase: "applying" }));
  assert.match(waiting, /<animate/); assert.doesNotMatch(waiting, /data-icon-complete/);
  const done = renderToStaticMarkup(createElement(CompressionProgressIcon, { state: "completed", phase: "done" }));
  assert.match(done, /data-icon-compression/); assert.doesNotMatch(done, /data-icon-complete|<animate/);
  for (const state of ["cancelled", "failed", "interrupted"]) assert.doesNotMatch(renderToStaticMarkup(createElement(CompressionProgressIcon, { state, phase: "summarizing" })), /<animate/);
  assert.match(renderToStaticMarkup(createElement(CompressionProgressIcon, { state: "completed", phase: "applying" })), /data-unknown/);
});
