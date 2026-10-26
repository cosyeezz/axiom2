// Offline native inventory tests, without Tauri, a running backend, or real installations.
import assert from "node:assert/strict";
import { mkdtemp, mkdir, realpath, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const temp = await realpath(await mkdtemp(join(tmpdir(), "axiom-inventory-native-")));
try {
  await mkdir(join(temp, "src"));
  await writeFile(join(temp, "Cargo.toml"), '[package]\nname = "inventory-fixture"\nversion = "0.1.0"\nedition = "2021"\n[dependencies]\nserde_json = "=1.0.149"\n[target.\'cfg(unix)\'.dependencies]\nlibc = "=0.2.182"\n');
  const module = name => `#[path = ${JSON.stringify(join(repo, "app/desktop", `${name}.rs`))}] mod ${name};`;
  await writeFile(join(temp, "src/main.rs"), `${module("axiom_bundled")}\n${module("axiom_environment")}\n${module("axiom_environment_process")}\nfn main() {\n if axiom_environment_process::worker() { return; }\n let root = std::env::args_os().nth(1).expect("fixture root");\n let result = axiom_environment_process::scan(std::path::Path::new(&root), std::env::args_os().nth(2).as_deref() == Some(std::ffi::OsStr::new("selected"))).expect("supervised scan");\n println!("{}", result);\n}\n`);
  if (process.env.AXIOM_TEST_CARGO_FETCH === '1') {
    const result = spawnSync('cargo', ['fetch', '--manifest-path', join(temp, 'Cargo.toml')], { stdio: 'inherit', timeout: 120_000 });
    assert.equal(result.status, 0, `fixture dependency preparation failed: ${result.error ?? result.signal ?? ''}`);
  }
  for (const action of ["test", "build"]) {
    const result = spawnSync("cargo", [action, "--offline", "--manifest-path", join(temp, "Cargo.toml")], { stdio: "inherit", timeout: 120_000 });
    assert.equal(result.status, 0, `cargo ${action} failed: ${result.error ?? result.signal ?? ""}`);
  }
  const root = join(temp, "data");
  await mkdir(join(root, "pi"), { recursive: true });
  await writeFile(join(root, "pi/auth.json"), "secret-fixture-do-not-export");
  const env = { ...process.env, PATH: "", AXIOM_PI_DIR: join(root, "pi") };
  const result = spawnSync(join(temp, "target/debug", process.platform === "win32" ? "inventory-fixture.exe" : "inventory-fixture"), [root], { env, encoding: "utf8", timeout: 12_000 });
  assert.equal(result.status, 0, result.stderr || String(result.error));
  assert.ok(!result.stdout.includes("secret-fixture-do-not-export"));
  const inventory = JSON.parse(result.stdout);
  const pi = inventory.items.find(item => item.id === "pi-resources");
  assert.equal(pi.state, "detected");
  assert.equal(pi.locations[0].files, 1);
  assert.equal(pi.locations[0].bytes, Buffer.byteLength("secret-fixture-do-not-export"));
  assert.equal(await readFile(join(root, "pi/auth.json"), "utf8"), "secret-fixture-do-not-export");
  const selected = spawnSync(join(temp, "target/debug", process.platform === "win32" ? "inventory-fixture.exe" : "inventory-fixture"), [root, "selected"], { env, encoding: "utf8", timeout: 12_000 });
  assert.equal(selected.status, 0, selected.stderr || String(selected.error));
  const selectedInventory = JSON.parse(selected.stdout);
  assert.equal(selectedInventory.scope, "selected");
  assert.equal(selectedInventory.origin, "unknown");
  assert.equal(selectedInventory.automaticRemovalAllowed, false);
  assert.equal(selectedInventory.items.length, 1);
  assert.equal(selectedInventory.commands.length, 0);
  assert.ok(!selected.stdout.includes("secret-fixture-do-not-export"));
  console.log(JSON.stringify({ passed: true, cases: ["selected worker isolation", "native unit tests", "real supervised worker dispatch", "isolated-root inventory", "no credential export", "no fixture modification"] }));
} finally { await rm(temp, { recursive: true, force: true }); }
