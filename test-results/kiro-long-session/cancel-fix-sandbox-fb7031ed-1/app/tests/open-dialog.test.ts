import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, writeFile, rm, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import type { ChildProcess } from "node:child_process";
import { OpenDialog, nativeOpenDialog, openDialogCommand } from "../src/server/open-dialog.js";
import { FolderPicker } from "../src/server/folder-picker.js";
import { AttachmentPicker } from "../src/server/attachment-picker.js";

const signal = () => new AbortController().signal;
test("all six modes enforce count/type/canonical paths and cancellation", async () => {
  const root = await mkdtemp(join(tmpdir(), "axiom-open-"));
  const file = join(root, "中文 & ' $.txt"), folder = join(root, "empty");
  await writeFile(file, "test"); await mkdir(folder);
  try {
    for (const kind of ["file", "folder", "mixed"] as const) for (const multiple of [false, true]) {
      const allowed = kind === "folder" ? folder : file;
      const picker = new OpenDialog(async () => multiple && kind === "mixed" ? [file, folder, file] : [allowed]);
      assert.deepEqual(await picker.select({ kind, multiple }, signal()),
        await Promise.all((multiple && kind === "mixed" ? [file, folder] : [allowed]).map((path) => realpath(path))));
      await picker.close();
      assert.deepEqual(await new OpenDialog(async () => []).select({ kind, multiple }, signal()), []);
      if (!multiple) await assert.rejects(new OpenDialog(async () => [allowed, allowed]).select({ kind, multiple }, signal()), { status: 400 });
      if (kind !== "mixed") await assert.rejects(new OpenDialog(async () => [kind === "file" ? folder : file]).select({ kind, multiple }, signal()), { status: 400 });
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("workspace and attachment adapters share a global slot until cancellation finishes", async () => {
  let exit!: () => void;
  const dialog = new OpenDialog((_options, signal) => new Promise((_resolve, reject) => {
    exit = () => reject(signal.reason);
  }));
  const folders = new FolderPicker(undefined, undefined, dialog), attachments = new AttachmentPicker(undefined, undefined, dialog);
  const abort = new AbortController();
  const pending = folders.select(abort.signal);
  await Promise.resolve();
  await assert.rejects(attachments.select(process.cwd(), signal()), { status: 409 });
  abort.abort();
  await assert.rejects(attachments.select(process.cwd(), signal()), { status: 409 });
  exit(); await assert.rejects(pending, { status: 499 });
  await dialog.close();
  await assert.rejects(folders.select(signal()), { status: 503 });
  await assert.rejects(attachments.select(process.cwd(), signal()), { status: 503 });
});

test("three platform hosts use the same JSON protocol for all modes; no path is source code", async () => {
  for (const platform of ["win32", "darwin", "linux"] as const) for (const kind of ["file", "folder", "mixed"] as const) for (const multiple of [false, true]) {
    const initialDirectory = "/中文/space & $(bad) '";
    const picker = nativeOpenDialog({ platform, spawn: (file, args, options) => {
      assert.deepEqual({ file, args }, openDialogCommand(platform));
      assert.equal(options.shell, false);
      assert.ok(!args.join(" ").includes(initialDirectory));
      assert.deepEqual(JSON.parse(options.env!.AXIOM_OPEN_OPTIONS!), { kind, multiple, initialDirectory, title: "打开" });
      const child = new EventEmitter() as ChildProcess;
      Object.assign(child, { stdout: new PassThrough(), stderr: new PassThrough(), exitCode: null, signalCode: null });
      queueMicrotask(() => { for (const byte of Buffer.from(JSON.stringify([initialDirectory]))) child.stdout!.emit("data", Buffer.from([byte])); child.emit("close", 0); });
      return child;
    } });
    assert.deepEqual(await picker({ kind, multiple, initialDirectory }, signal()), [initialDirectory]);
  }
});
