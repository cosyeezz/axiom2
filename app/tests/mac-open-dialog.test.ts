import assert from "node:assert/strict";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import { macOpenScript } from "../src/server/open-dialog-scripts.js";

type Options = { kind: string; multiple: boolean; title: string; initialDirectory: string };
type Timer = { mode?: unknown; valid: boolean; tick: () => void };

// Executes the shipped JXA body against an AppKit contract double. runModal first blocks
// the main thread while it connects the remote Open panel; an activation requested before
// the modal session drains events makes the host frontmost but loses its activation
// notification, after which further requests are no-ops. An inactive host's remote Open
// panel ignores clicks, so the double only lets activation requested inside the session work.
function runHost(options: Options, paths: string[], { cancel = false, systemActivates = true } = {}) {
  const MODAL_MODE = "NSModalPanelRunLoopMode";
  let launched = false, visible = false, key = false, front = false, active = false, centered = false, modal = false;
  let policy: unknown, requests = 0;
  const timers: Timer[] = [];
  const panel = {
    title: "", prompt: "", canChooseFiles: false, canChooseDirectories: false,
    allowsMultipleSelection: false, canCreateDirectories: false, resolvesAliases: false,
    directoryURL: "",
    get center() { centered = true; return undefined; },
    makeKeyAndOrderFront(sender: unknown) {
      assert.equal(sender, null);
      assert.ok(launched && centered, "the standalone host must finish launch and place its panel before presenting");
      visible = true; key = true;
    },
    get isKeyWindow() { return key && active; },
    get runModal() {
      assert.ok(visible && key, "the panel must be visible and key before the modal session");
      assert.equal(policy, 1);
      assert.equal(this.title, options.title);
      assert.equal(this.canChooseFiles, options.kind !== "folder");
      assert.equal(this.canChooseDirectories, options.kind !== "file");
      assert.equal(this.allowsMultipleSelection, options.multiple);
      assert.equal(this.directoryURL, options.initialDirectory);
      assert.ok(this.canCreateDirectories && this.resolvesAliases);
      modal = true;
      // The modal session services only timers registered for its run loop mode.
      for (let tick = 0; tick < 200; tick++) {
        const due = timers.filter((timer) => timer.valid && timer.mode === MODAL_MODE);
        if (!due.length) break;
        for (const timer of due) timer.tick();
      }
      modal = false;
      if (systemActivates) assert.ok(active, "clicks reach the remote panel only once its host is active");
      return cancel ? 0 : 1;
    },
    get URLs() {
      assert.equal(cancel, false, "cancellation must not read stale selections");
      return { count: paths.length, objectAtIndex: (index: number) => ({ path: paths[index] }) };
    },
  };
  const app = {
    setActivationPolicy(value: unknown) { policy = value; },
    get finishLaunching() { launched = true; return undefined; },
    get isActive() { return active; },
    activateIgnoringOtherApps(value: boolean) {
      assert.ok(value && launched && visible && key, "activation must target the already presented panel");
      requests++;
      if (!systemActivates || front) return;
      front = true;
      // Outside the modal session the host cannot drain events and the notification is lost.
      if (modal) active = true;
    },
  };
  const NSTimer = {
    timerWithTimeIntervalRepeatsBlock(interval: number, repeats: boolean, block: () => void) {
      assert.ok(interval > 0 && interval <= 0.5 && repeats);
      const timer: Timer & { readonly invalidate: undefined } = {
        valid: true, tick: block,
        get invalidate() { timer.valid = false; return undefined; },
      };
      timers.push(timer);
      return timer;
    },
  };
  const result = runInNewContext(`${macOpenScript}\nrun();`, {
    ObjC: { import() {}, unwrap: (value: unknown) => value },
    $: {
      NSApplication: { sharedApplication: app }, NSApplicationActivationPolicyAccessory: 1,
      NSProcessInfo: { processInfo: { environment: { objectForKey: (name: string) => {
        assert.equal(name, "AXIOM_OPEN_OPTIONS"); return JSON.stringify(options);
      } } } },
      NSOpenPanel: { openPanel: panel }, NSModalResponseOK: 1,
      NSURL: { fileURLWithPath: (path: string) => path },
      NSTimer, NSModalPanelRunLoopMode: MODAL_MODE,
      NSRunLoop: { mainRunLoop: { addTimerForMode(timer: Timer, mode: unknown) { timer.mode = mode; } } },
    },
  });
  assert.ok(timers.length > 0 && timers.every((timer) => !timer.valid), "activation retries must stop by the end of the session");
  return { result: JSON.parse(result) as string[], requests, active };
}

test("macOS host activates only inside the modal session, preserving selection modes and cancellation", () => {
  const file = "/tmp/中文 & $(literal)/note.txt", folder = "/tmp/中文 & $(literal)/folder";
  for (const kind of ["file", "folder", "mixed"]) for (const multiple of [false, true]) for (const cancel of [false, true]) {
    const paths = multiple && kind === "mixed" ? [file, folder] : [kind === "folder" ? folder : file];
    const options = { kind, multiple, title: "选择项目", initialDirectory: "/tmp/中文 & $(literal)" };
    const run = runHost(options, paths, { cancel });
    assert.deepEqual(run.result, cancel ? [] : paths);
    assert.ok(run.active);
  }
});

test("macOS host bounds activation retries when the system refuses focus", () => {
  const options = { kind: "file", multiple: false, title: "选择文件", initialDirectory: "/tmp" };
  const run = runHost(options, ["/tmp/note.txt"], { systemActivates: false });
  assert.deepEqual(run.result, ["/tmp/note.txt"]);
  assert.equal(run.active, false);
  assert.ok(run.requests > 2 && run.requests <= 60, `retries are repeated but bounded (got ${run.requests})`);
});
