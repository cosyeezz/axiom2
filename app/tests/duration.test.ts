import assert from "node:assert/strict";
import { test } from "node:test";
import { durationTooltip, formatDuration, sessionDuration } from "../src/client/chat/duration.js";
import { emptyAgent, type AgentInfo, type Run } from "../src/shared/agent.js";

test("older backend snapshots keep the timer visible and label its limited scope", () => {
  const info: AgentInfo = { ...emptyAgent, run: {
    id: "run", sessionId: "session", status: "running",
    selection: { provider: "fixture", id: "fixture", thinking: "off" },
    startedAt: 1_000, endedAt: null, error: null,
  } };
  for (const status of ["starting", "running", "stopping"] as Run["status"][]) {
    info.run!.status = status;
    assert.equal(sessionDuration(info, 12_000), 11);
    assert.equal(sessionDuration(info, 13_000), 12);
  }
  assert.match(durationTooltip(info), /最近一次运行时间.*重启后台/);
  for (const status of ["completed", "cancelled", "failed", "interrupted"] as Run["status"][]) {
    info.run = { ...info.run!, status, endedAt: 11_000 };
    assert.equal(sessionDuration(info, 100_000), 10, "idle time is excluded");
    info.run.endedAt = null;
    assert.equal(sessionDuration(info, 100_000), null, "unknown terminal time cannot keep ticking");
  }
  info.run = { ...info.run!, status: "running", startedAt: 100_000 };
  info.completedRunDurationMs = 15_000;
  assert.equal(sessionDuration(info, 103_000), 18, "new backend immediately restores the full total");
  assert.match(durationTooltip(info), /主会话累计运行时间/);
  assert.equal(sessionDuration(emptyAgent, 103_000), null);
});

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
