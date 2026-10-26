import assert from "node:assert/strict";
import { test } from "node:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
const run = promisify(execFile);

for (const exitCode of [0, 7]) {
  test(`Windows setup preserves npm diagnostics and coordinator exit ${exitCode}`, { skip: process.platform !== "win32" }, async t => {
    const root = await mkdtemp(join(tmpdir(), "axiom-setup-wrapper-"));
    t.after(() => rm(root, { recursive: true, force: true }));
    const helper = join(root, "service.mjs"), result = join(root, "result.txt"), wrapper = join(root, "setup.ps1");
    // The native bridge writes a BOM for Windows PowerShell 5.1.
    await writeFile(wrapper, "\ufeff" + await readFile(resolve("desktop/setup.ps1"), "utf8"));
    await writeFile(helper, `
      console.log('@@phase:fixture coordinator started');
      console.error('npm http fetch GET 200 https://registry.npmjs.org/fixture');
      setTimeout(() => {
        console.log('@@phase:fixture coordinator completed');
        ${exitCode ? "console.error('@@error:fixture npm failure');" : ""}
        process.exitCode = ${exitCode};
      }, 200);
    `);
    const env: NodeJS.ProcessEnv = { ...process.env, AXIOM_DATA_DIR: root, AXIOM_SETUP_SERVICE: helper, AXIOM_SETUP_RESULT: result };
    delete env.AXIOM_SETUP_TASK_DIR;
    let output = "", code = 0;
    try {
      const value = await run(join(process.env.SystemRoot!, "System32/WindowsPowerShell/v1.0/powershell.exe"),
        ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", wrapper, "-Action", "service"], { env, timeout: 30000 });
      output = value.stdout + value.stderr;
    } catch (error: any) { code = error.code; output = error.stdout + error.stderr; }
    assert.equal(code, exitCode, output);
    assert.match(output, /npm http fetch GET 200/, "ordinary npm stderr is preserved as diagnostics");
    assert.match(output, /@@phase:fixture coordinator completed/, "stderr must not terminate the installation coordinator");
    if (exitCode) assert.match(output, /@@error:fixture npm failure/);
    assert.equal((await readFile(result, "utf8")).trim(), String(exitCode));
  });
}
