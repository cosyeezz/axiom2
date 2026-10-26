import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { costLevel, type CostLevel } from "../src/client/chat/cost-level.js";
import { CostUsageIcon } from "../src/client/chat/UsageIcons.js";

const boundaries = [[0, 0], [9.999, 0], [10, 1], [19.999, 1], [20, 2], [29.999, 2], [30, 3], [39.999, 3], [40, 4], [50, 4], [1e100, 4]] as const;
test("cost tiers advance at exact dollar or running-minute boundaries, without rounding", () => {
  for (const [value, level] of boundaries) {
    assert.equal(costLevel(value, null), level, `$${value}`);
    assert.equal(costLevel(null, value * 60), level, `${value} minutes`);
  }
  assert.equal(costLevel(9.9999, 599.9999), 0);
  assert.equal(costLevel(19.9999, 1199.9999), 1);
});
test("whichever metric reaches a threshold first governs, including mixed directions", () => {
  assert.equal(costLevel(8, 25 * 60), 2);
  assert.equal(costLevel(35, 12 * 60), 3);
  for (const [dollars, dollarLevel] of boundaries) for (const [minutes, minuteLevel] of boundaries) {
    assert.equal(costLevel(dollars, minutes * 60), Math.max(dollarLevel, minuteLevel), `${dollars} USD / ${minutes} minutes`);
  }
});
test("unknown/invalid inputs never masquerade as zero and cannot suppress a valid trigger", () => {
  for (const invalid of [null, undefined, NaN, Infinity, -Infinity, -1]) {
    assert.equal(costLevel(invalid, invalid), null);
    assert.equal(costLevel(invalid, 0), 0);
    assert.equal(costLevel(0, invalid), 0);
    assert.equal(costLevel(invalid, 30 * 60), 3);
    assert.equal(costLevel(40, invalid), 4);
  }
});
test("cost icon preserves the chart and accumulates colored bars; only the pre-alert bar pulses", () => {
  for (const level of [null, 0, 1, 2, 3, 4] as const) {
    const svg = renderToStaticMarkup(createElement(CostUsageIcon, { level }));
    assert.match(svg, /viewBox="2 2 20 20"/);
    assert.match(svg, /class="cost-axis" d="M3 3v16a2 2 0 0 0 2 2h16"/);
    assert.equal((svg.match(/<path /g) ?? []).length, 4);
    assert.equal((svg.match(/class="cost-bar"/g) ?? []).length, 3);
    const tones = [...svg.matchAll(/data-tone="([a-z]+)"/g)].map(match => match[1]);
    assert.deepEqual(tones, [level == null ? "neutral" : "success", level != null && level >= 1 ? "warning" : "neutral", level != null && level >= 3 ? "danger" : "neutral"]);
    const pulsing = [...svg.matchAll(/<path[^>]+data-pulse="true"[^>]*>/g)].map(match => match[0]);
    assert.equal(pulsing.length, level === 1 || level === 3 ? 1 : 0, String(level));
    if (pulsing.length) assert.ok(pulsing[0].includes(`data-tone="${level === 1 ? "warning" : "danger"}"`));
    assert.match(svg, new RegExp(`data-level="${level ?? "unknown"}"`));
    assert.doesNotMatch(svg, /<use|<animate/);
  }
});
