import assert from "node:assert/strict";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import { macOpenScript } from "../src/server/open-dialog-scripts.js";

// Executes the shipped JXA body against an AppKit contract double. Native focus
// and Finder interaction still require macOS; this covers the script/protocol boundary.
test("macOS host launches and presents an input window before activation, preserving selection modes and cancellation", () => {
  const file = "/tmp/中文 & $(literal)/note.txt", folder = "/tmp/中文 & $(literal)/folder";
  for (const kind of ["file", "folder", "mixed"]) for (const multiple of [false, true]) for (const cancel of [false, true]) {
    let launched = false, visible = false, key = false, active = false, centered = false;
    let policy: unknown;
    const paths = multiple && kind === "mixed" ? [file, folder] : [kind === "folder" ? folder : file];
    const options = { kind, multiple, title: "选择项目", initialDirectory: "/tmp/中文 & $(literal)" };
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
      get runModal() {
        assert.ok(visible && key && active, "a visible, key panel must belong to the active host before interaction");
        assert.equal(policy, 1);
        assert.equal(this.title, options.title);
        assert.equal(this.canChooseFiles, kind !== "folder");
        assert.equal(this.canChooseDirectories, kind !== "file");
        assert.equal(this.allowsMultipleSelection, multiple);
        assert.equal(this.directoryURL, options.initialDirectory);
        assert.ok(this.canCreateDirectories && this.resolvesAliases);
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
      activateIgnoringOtherApps(value: boolean) {
        assert.ok(value && launched && visible && key, "activation must target the already presented panel");
        active = true;
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
      },
    });
    assert.deepEqual(JSON.parse(result), cancel ? [] : paths);
  }
});
