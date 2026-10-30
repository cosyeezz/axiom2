import test from "node:test";
import assert from "node:assert/strict";
import { componentActionIcons, componentInstallAction, compareComponentVersions, resolveComponentActions, type ComponentActionId } from "../src/shared/component-actions.js";

const connected = { connected: true };
test("capability absence is different from a temporary blocker", () => {
  const actions = resolveComponentActions([
    { id: "install", label: "安装", support: "unsupported" },
    { id: "check-versions", label: "检查", support: "unknown" },
    { id: "cleanup-package", label: "清包", applicable: false },
    { id: "open-installer", label: "打开安装器", blockedReason: "请先下载映像" },
    { id: "uninstall", label: "卸载" },
  ], connected);
  assert.deepEqual(actions.map(action => action.id), ["open-installer", "uninstall"]);
  assert.equal(actions[0].available, false);
  assert.equal(actions[0].reason, "请先下载映像");
  assert.equal(actions[1].available, true);
});
test("core maintenance retains conflicting task gates without hiding actions", () => {
  const ids: ComponentActionId[] = ["install", "update", "reinstall", "switch-version", "repair", "uninstall"];
  const actions = resolveComponentActions(ids.map(id => ({ id, label: id, conflictsWithTask: true })), { connected: true, taskRunning: true });
  assert.equal(actions.length, ids.length);
  assert.ok(actions.every(action => !action.available && action.reason?.includes("完成或取消")));
  assert.ok(resolveComponentActions(ids.map(id => ({ id, label: id, conflictsWithTask: true })), connected).every(action => action.available));
  assert.equal(resolveComponentActions([{ id: "check-versions", label: "只读检查", conflictsWithTask: false }], { connected: true, taskRunning: true })[0].available, true);
  assert.equal(resolveComponentActions([{ id: "install", label: "安装", blockedReason: "宿主未安装" }], { connected: true, taskRunning: true })[0].reason, "宿主未安装");
});
test("empty or whitespace reasons cannot bypass a conflicting task", () => {
  for (const blockedReason of [undefined, "", " ", "\n\t"]) {
    for (const id of Object.keys(componentActionIcons) as ComponentActionId[]) {
      const capability = { id, label: id, conflictsWithTask: true, blockedReason };
      const blocked = resolveComponentActions([capability], { connected: true, taskRunning: true })[0];
      assert.equal(blocked.available, false, `${id}: ${JSON.stringify(blockedReason)}`);
      assert.match(blocked.reason!, /完成或取消/);
      assert.equal(resolveComponentActions([capability], connected)[0].available, true);
    }
  }
});
test("auxiliary operations expose real task conflicts without disappearing", () => {
  const ids: ComponentActionId[] = ["check-install", "check-environment", "check-versions", "download-package", "install-cached", "open-installer", "cleanup-package"];
  const actions = resolveComponentActions(ids.map(id => ({ id, label: id, conflictsWithTask: true })), { connected: true, taskRunning: true });
  assert.equal(actions.length, ids.length);
  assert.ok(actions.every(action => !action.available && action.reason?.includes("完成或取消")));
});
test("disconnected or in-flight requests remain discoverable and are never queued", () => {
  for (const context of [{ connected: false, taskRunning: true }, { connected: true, sending: true }]) {
    const actions = resolveComponentActions([{ id: "uninstall", label: "卸载" }, { id: "install", label: "安装" }], context);
    assert.equal(actions.length, 2);
    assert.ok(actions.every(action => !action.available && !!action.reason));
  }
  assert.match(resolveComponentActions([{ id: "install", label: "安装" }], { connected: false })[0].reason!, /操作未发送/);
  assert.equal(resolveComponentActions([{ id: "install", label: "安装" }], connected)[0].available, true);
});
test("installation, version comparison and health independently name the primary action", () => {
  const cases = [
    [{ installation: "missing" }, "install"],
    [{ installation: "unknown", version: undefined }, "install"],
    [{ installation: "installed", version: undefined }, "reinstall"],
    [{ installation: "installed", version: "2.0.0", target: undefined }, "reinstall"],
    [{ installation: "installed", version: "2.0.0", target: "2.0.0" }, "reinstall"],
    [{ installation: "installed", version: "2.0.0", target: "2.1.0" }, "update"],
    [{ installation: "installed", version: "2.0.0", target: "1.9.0" }, "switch-version"],
    [{ installation: "installed", version: "nightly", target: "2.0.0" }, "reinstall"],
    [{ installation: "incomplete", repairByReinstall: true }, "repair"],
    [{ installation: "incomplete", repairByReinstall: false }, "reinstall"],
  ] as const;
  for (const [options, id] of cases) {
    const action = componentInstallAction({ label: "组件", ...options });
    assert.equal(action.id, id, JSON.stringify(options));
    assert.equal(action.primary, true);
    if (id === "repair") assert.match(action.label, /重新安装/);
    if (id === "switch-version") assert.match(action.label, /切换/);
  }
  const special = componentInstallAction({ label: "Hopper", installation: "installed", version: "5.19.2-v5", target: "5.19.3-v5", compare: () => 1 });
  assert.equal(special.id, "update", "adapter comparisons handle special versions");
});
test("numeric comparison is explicit and unknown versions are never assumed newer", () => {
  assert.equal(compareComponentVersions("v2.10.0", "2.9.9"), 1);
  assert.equal(compareComponentVersions("1", "1.0.0"), 0);
  assert.equal(compareComponentVersions("1.2", "2"), -1);
  for (const value of ["", "nightly", "1.2.0-beta", "1.2.3.4.5", "21+build"]) assert.equal(compareComponentVersions(value, "1.0.0"), undefined);
});
test("six user-selected semantic actions have distinct glyph keys", () => {
  const ids: ComponentActionId[] = ["cleanup-package", "download-package", "install-cached", "open-installer", "switch-version", "repair"];
  assert.equal(new Set(ids.map(id => componentActionIcons[id])).size, 6);
  for (const id of ids) assert.equal(componentActionIcons[id], id);
});
