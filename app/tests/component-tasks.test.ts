import assert from "node:assert/strict";
import { test } from "node:test";
import { componentTasks } from "../src/client/maintenance/component-tasks.js";
import { defaultMaintenanceBudgets, type MaintenanceTask } from "../src/shared/maintenance.js";
const task = (id: string, resource: string, status: MaintenanceTask["status"], createdAt = 1): MaintenanceTask => ({ id, resource, status, createdAt, updatedAt: createdAt, attemptId: id, label: resource, action: "install", endpoint: "backend", scope: "test", phase: "checking", steps: ["checking"], completedSteps: 0, budgets: defaultMaintenanceBudgets, capabilities: { cancel: false, extend: false } });
test("component task selection is exact, not a dependency or prefix match", () => {
  const tasks = [task("core", "rea", "succeeded"), task("engine", "rea:java", "running", 2), task("other", "rtk", "unknown", 3)];
  assert.equal(componentTasks(tasks, "rea").current?.id, "core");
  assert.deepEqual(componentTasks(tasks, "rea").unresolved, []);
  assert.equal(componentTasks(tasks, "absent").current, undefined);
});
test("legacy resource overview retains prefix matching and explicit task identity", () => {
  const tasks = [task("legacy", "resources", "succeeded"), task("child", "resources:skills", "running", 2), task("foreign", "resources-other", "running", 3)];
  assert.equal(componentTasks(tasks, "resources").current?.id, "child");
  assert.equal(componentTasks(tasks, "resources", "legacy").current?.id, "legacy");
  assert.equal(componentTasks(tasks, "resources", "foreign").current, undefined);
});
test("active work takes precedence over newer completed checks", () => {
  assert.equal(componentTasks([task("running", "opencli", "running"), task("checked", "opencli", "succeeded", 2)], "opencli").current?.id, "running");
});
test("component standard: only the latest attempt is shown, with no unresolved or history records", () => {
  const tasks = [task("unknown", "rtk", "unknown"), task("interrupted", "rtk", "interrupted", 2), task("new", "rtk", "succeeded", 3)];
  const { current, unresolved, history } = componentTasks(tasks, "rtk");
  assert.equal(current?.id, "new"); assert.deepEqual(unresolved, []); assert.deepEqual(history, []);
  assert.deepEqual(tasks.map(task => task.id), ["unknown", "interrupted", "new"], "selection never mutates the subscribed snapshot");
});
test("same timestamp uses the later published task", () => {
  const { current, unresolved } = componentTasks([task("first", "rea", "interrupted"), task("second", "rea", "unknown")], "rea");
  assert.equal(current?.id, "second"); assert.deepEqual(unresolved, []);
});
