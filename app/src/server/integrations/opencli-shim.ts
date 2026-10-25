import { openCliCommandDirectory, type OpenCliConfig } from "./opencli-runtime.js";

/** Run the same platform entry points used by shell tools, under the candidate PATH. */
export function openCliShimProbe(config: OpenCliConfig): string[] {
  const script = `
const {spawnSync} = require('node:child_process');
const {join, dirname, delimiter} = require('node:path');
const bin = process.argv[1];
const results = [];
if (process.platform === 'win32') {
  const ps = join(process.env.SystemRoot || 'C:\\\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  for (const suffix of ['.cmd', '.ps1']) {
    const path = join(bin, 'opencli' + suffix).replace(/'/g, "''");
    const result = spawnSync(ps, ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', "$ErrorActionPreference='Stop'; & '" + path + "' --version; if ($LASTEXITCODE) { exit $LASTEXITCODE }"], {encoding:'utf8', windowsHide:true, env:{...process.env, PATH:dirname(process.execPath)+delimiter+(process.env.PATH||'')}});
    if (result.error || result.status !== 0) process.exit(1);
    results.push(result.stdout.trim());
  }
} else {
  const result = spawnSync(join(bin, 'opencli'), ['--version'], {encoding:'utf8'});
  if (result.error || result.status !== 0) process.exit(1);
  results.push(result.stdout.trim());
}
process.stdout.write(JSON.stringify(results));`;
  return ["-e", script, openCliCommandDirectory(config)];
}
