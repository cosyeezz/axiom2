import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { test } from "node:test";
import { moveUsageDay, moveUsageMonth, parseUsageDay, usageCalendar, usageDateBoundary, usageDatePreset, usageDay, usageRangeError, usageRangeLabel } from "../src/client/usage-dates.js";

test("usage days validate calendar dates including leap years, bounded years and exact formatting", () => {
  for (const invalid of ["", "2024-2-01", "2024-02-30", "2023-02-29", "2024-13-01", "0000-01-01", "10000-01-01", "2024-01-00", "2024-01-01T00:00:00Z"]) assert.equal(parseUsageDay(invalid), undefined, invalid);
  for (const valid of ["0001-01-01", "0099-12-31", "2024-02-29", "9999-12-31"]) assert.equal(usageDay(parseUsageDay(valid)!), valid);
  assert.equal(usageDay(new Date(NaN)), "");
});
test("usage day and month navigation clamps end-of-month without rolling into March", () => {
  assert.equal(moveUsageDay("2024-02-28", 1), "2024-02-29"); assert.equal(moveUsageDay("2024-02-29", 1), "2024-03-01");
  assert.equal(moveUsageMonth("2024-01-31", 1), "2024-02-29"); assert.equal(moveUsageMonth("2024-02-29", 12), "2025-02-28");
  assert.equal(moveUsageMonth("2024-01-31", -1), "2023-12-31"); assert.equal(moveUsageMonth("0001-01-01", -1), "0001-01-01");
  assert.equal(moveUsageDay("9999-12-31", 1), "9999-12-31"); assert.equal(moveUsageDay("invalid", 1), "invalid");
});
test("usage calendar is a Monday-first six-week grid and includes adjacent months", () => {
  const days = usageCalendar("2024-09-01"); assert.equal(days.length, 42); assert.equal(days[0], "2024-08-26"); assert.equal(days[6], "2024-09-01"); assert.equal(days.at(-1), "2024-10-06");
  assert.equal(usageCalendar("9999-12-01").length, 42); assert.deepEqual(usageCalendar("invalid"), []);
});
test("usage date ranges validate order and remain open-ended when a bound is cleared", () => {
  assert.equal(usageRangeError({ from: "2024-02-29", to: "2024-02-29" }), "");
  assert.match(usageRangeError({ from: "2024-03-01", to: "2024-02-29" }), /不能晚于/);
  assert.match(usageRangeError({ from: "2024-02-30", to: "" }), /有效日期/);
  assert.equal(usageRangeError({ from: "", to: "2024-02-29" }), "");
  assert.equal(usageRangeLabel({ from: "", to: "" }), "全部日期"); assert.match(usageRangeLabel({ from: "", to: "2024-01-01" }), /不限开始/);
});
test("usage presets include today and use local calendar boundaries", () => {
  const now = parseUsageDay("2024-03-01")!;
  assert.deepEqual(usageDatePreset("today", now), { from: "2024-03-01", to: "2024-03-01" });
  assert.deepEqual(usageDatePreset("week", now), { from: "2024-02-24", to: "2024-03-01" });
  assert.deepEqual(usageDatePreset("month30", now), { from: "2024-02-01", to: "2024-03-01" });
  assert.deepEqual(usageDatePreset("month", now), { from: "2024-03-01", to: "2024-03-01" });
  assert.deepEqual(usageDatePreset("all", now), { from: "", to: "" });
  assert.equal(usageDateBoundary("", false), undefined); assert.equal(usageDateBoundary("2024-02-30", false), undefined);
});
test("local day boundaries honor DST and never derive a day from UTC ISO slices", () => {
  const moduleUrl = new URL("../src/client/usage-dates.ts", import.meta.url).href;
  const code = `import {usageDateBoundary, parseUsageDay, usageDay} from ${JSON.stringify(moduleUrl)}; console.log(JSON.stringify({ span: usageDateBoundary('2024-03-10',true)-usageDateBoundary('2024-03-10',false)+1, day: usageDay(parseUsageDay('2024-01-01')) }));`;
  const run = (tz: string) => JSON.parse(execFileSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", code], { encoding: "utf8", env: { ...process.env, TZ: tz } }));
  assert.deepEqual(run("America/New_York"), { span: 23 * 3600000, day: "2024-01-01" });
  assert.deepEqual(run("Pacific/Auckland"), { span: 24 * 3600000, day: "2024-01-01" });
});
