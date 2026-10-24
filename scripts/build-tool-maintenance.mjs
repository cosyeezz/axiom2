import { build } from 'esbuild';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export async function buildToolMaintenance(outfile) {
  const result = await build({ entryPoints: [resolve(repo, 'app/desktop/tool-maintenance-entry.mjs')], outfile, bundle: true, platform: 'node', format: 'esm', target: 'node22.19', metafile: true, logLevel: 'silent' });
  for (const output of Object.values(result.metafile.outputs)) {
    if (output.imports.some(item => !item.path.startsWith('node:'))) throw Error('Offline tool maintenance must only depend on built-in Node modules.');
  }
}
