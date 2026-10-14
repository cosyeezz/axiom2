import assert from "node:assert/strict";
import { test } from "node:test";
import { formatDuration } from "../src/client/chat/duration.js";

test("duration uses seconds until a full minute is reached", () => {
  for (const [seconds, expected] of [
    [0, "0s"], [0.9, "0s"], [1, "1s"], [59, "59s"], [59.999, "59s"],
  ] as const) assert.equal(formatDuration(seconds), expected);
});

test("duration carries into minutes, hours and days while retaining every remainder", () => {
  for (const [seconds, expected] of [
    [60, "1m0s"], [61, "1m1s"], [110, "1m50s"],
    [119.999, "1m59s"], [120, "2m0s"],
    [3599.999, "59m59s"], [3600, "1h0m0s"], [3601, "1h0m1s"],
    [3723, "1h2m3s"], [7200, "2h0m0s"],
    [86399.999, "23h59m59s"], [86400, "1d0h0m0s"],
    [86401, "1d0h0m1s"], [93784, "1d2h3m4s"],
    [172800, "2d0h0m0s"], [86400 * 365, "365d0h0m0s"],
  ] as const) assert.equal(formatDuration(seconds), expected);
});

test("duration preserves unknown values and clamps negative elapsed time", () => {
  for (const value of [null, undefined, NaN, Infinity, -Infinity]) {
    assert.equal(formatDuration(value), "—");
  }
  assert.equal(formatDuration(-1), "0s");
});
