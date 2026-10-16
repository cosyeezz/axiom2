import assert from "node:assert/strict";
import { test } from "node:test";
import { TaskPhase, TaskBudgetReminder, taskBudgetWarning } from "../src/server/task-budget.js";

test("a renewed work deadline can interrupt blocked append preparation and re-enter summary", async () => {
  const phase = new TaskPhase();
  phase.change("summary");
  phase.change("work");
  let release!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  let drained = false;
  const drain = phase.drain(pending, phase.revision).then(() => { drained = true; });
  await Promise.resolve();
  assert.equal(drained, false, "work waits for the accepted append to be prepared");
  phase.change("summary");
  await drain;
  assert.equal(phase.stage, "summary", "the latest deadline wins without waiting for input preparation");
  await phase.drain(pending, phase.revision - 1);
  release();
});

test("budget warning uses server time, caps lead at 60s, and does not repeat for the same deadline", (t) => {
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: 0 });
  const notices: number[] = [];
  const reminder = new TaskBudgetReminder((deadline) => { notices.push(deadline); return true; });
  t.after(() => reminder.dispose());
  reminder.update({ workMs: 600_000, elapsedMs: 0, deadlineAt: 600_000 });
  t.mock.timers.tick(539_999);
  assert.deepEqual(notices, []);
  t.mock.timers.tick(1);
  assert.deepEqual(notices, [600_000]);
  assert.match(taskBudgetWarning(600_000), /剩余约 60 秒/);
  reminder.flush();
  reminder.update({ workMs: 600_000, elapsedMs: 0, deadlineAt: 600_000 });
  t.mock.timers.tick(60_000);
  assert.deepEqual(notices, [600_000]);
});

test("restoring a previously warned deadline does not inject it again", (t) => {
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: 0 });
  const notices: number[] = [];
  const reminder = new TaskBudgetReminder((deadline) => { notices.push(deadline); return true; });
  t.after(() => reminder.dispose());
  reminder.update({ workMs: 10_000, elapsedMs: 0, deadlineAt: 10_000 });
  t.mock.timers.tick(8500);
  reminder.update({ workMs: 9000, elapsedMs: 0, deadlineAt: 9000 });
  reminder.update({ workMs: 10_000, elapsedMs: 0, deadlineAt: 10_000 });
  reminder.flush();
  assert.deepEqual(notices, [10_000, 9000]);
});

test("short budgets warn at 80%, wait for initialization, and skip expired runs", (t) => {
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: 0 });
  let accepting = false;
  const notices: number[] = [];
  const reminder = new TaskBudgetReminder((deadline) => {
    if (!accepting) return false;
    notices.push(deadline); return true;
  });
  t.after(() => reminder.dispose());
  reminder.update({ workMs: 10_000, elapsedMs: 5000, deadlineAt: 10_000 });
  t.mock.timers.tick(7999);
  accepting = true;
  reminder.flush();
  assert.deepEqual(notices, []);
  accepting = false;
  t.mock.timers.tick(1);
  assert.deepEqual(notices, []);
  t.mock.timers.tick(500);
  accepting = true;
  reminder.flush();
  assert.deepEqual(notices, [10_000]);
  reminder.update({ workMs: 1000, elapsedMs: 0, deadlineAt: 8000 });
  reminder.flush();
  assert.deepEqual(notices, [10_000]);
});

test("budget updates replace old alarms, shortening warns immediately, and disposal cancels pending alarms", (t) => {
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: 0 });
  const notices: number[] = [];
  const reminder = new TaskBudgetReminder((deadline) => { notices.push(deadline); return true; });
  t.after(() => reminder.dispose());
  reminder.update({ workMs: 10_000, elapsedMs: 0, deadlineAt: 10_000 });
  t.mock.timers.tick(7000);
  reminder.update({ workMs: 20_000, elapsedMs: 0, deadlineAt: 20_000 });
  t.mock.timers.tick(2000);
  assert.deepEqual(notices, [], "extension cancels the original warning");
  reminder.update({ workMs: 10_000, elapsedMs: 0, deadlineAt: 10_000 });
  assert.deepEqual(notices, [10_000], "shortening into the warning window warns now");
  reminder.update({ workMs: 20_000, elapsedMs: 0, deadlineAt: 20_000 });
  t.mock.timers.tick(7000);
  assert.deepEqual(notices, [10_000, 20_000]);
  reminder.update({ workMs: 30_000, elapsedMs: 0, deadlineAt: 30_000 });
  reminder.dispose();
  t.mock.timers.tick(30_000);
  reminder.flush();
  assert.deepEqual(notices, [10_000, 20_000], "finished or stopped workers never emit delayed warnings");
});
