// Compile only the production archive worker into an isolated executable.
import { after } from 'node:test';
import { mkdtemp, mkdir, realpath, writeFile, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
export let archiveExecutable: string | undefined;
if (process.platform !== 'win32') {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'axiom-archive-native-test-')));
  after(() => rm(directory, { recursive: true, force: true }));
  await mkdir(join(directory, 'src'));
  await writeFile(join(directory, 'Cargo.toml'), '[package]\nname="archive-fixture"\nversion="0.1.0"\nedition="2021"\n[dependencies]\nserde_json="=1.0.149"\nsha2="0.10.9"\nlibc="=0.2.182"\n');
  const source = fileURLToPath(new URL('../../desktop/axiom_archive.rs', import.meta.url));
  await writeFile(join(directory, 'src/main.rs'), `#[path=${JSON.stringify(source)}] mod archive;\nfn main() { if !archive::worker() { std::process::exit(2); } }\n`);
  // Fresh CI runners may fetch pinned compiler dependencies during test setup.
  // Test execution and all product cleanup operations remain offline.
  if (process.env.AXIOM_TEST_CARGO_FETCH === '1') execFileSync('cargo', ['fetch', '--manifest-path', join(directory, 'Cargo.toml')], { stdio: 'inherit', timeout: 120_000 });
  execFileSync('cargo', ['test', '--offline', '--manifest-path', join(directory, 'Cargo.toml')], { stdio: 'inherit', timeout: 120_000 });
  execFileSync('cargo', ['build', '--offline', '--manifest-path', join(directory, 'Cargo.toml')], { stdio: 'inherit', timeout: 120_000 });
  archiveExecutable = join(directory, 'target/debug/archive-fixture');
}
