// Build release-owned helpers; never compile or download a tool at application runtime.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
if (process.platform !== "linux") {
  console.log("Linux ownership helper is built on Linux release runners.");
  process.exit(0);
}
if (!["x64", "arm64"].includes(process.arch)) throw Error(`Unsupported native ownership build: ${process.arch}`);
const directory = join(root, "bin", "native", `linux-${process.arch}`), source = join(root, "native", "axiom-owner.c");
mkdirSync(directory, { recursive: true });
const output = join(directory, "axiom-owner"), temporary = `${output}.${process.pid}.tmp`;
try {
  const compiled = spawnSync("cc", ["-std=c11", "-O2", "-Wall", "-Wextra", "-Werror", "-static", "-fno-ident", source, "-o", temporary], { stdio: "inherit", timeout: 60000 });
  if (compiled.error || compiled.status !== 0) throw Error("Native ownership build failed; a local C toolchain with static libc is required on the build runner.", { cause: compiled.error });
  chmodSync(temporary, 0o755);
  renameSync(temporary, output);
  writeFileSync(join(directory, "manifest.json"), JSON.stringify({ protocol: 1, arch: process.arch,
    sha256: createHash("sha256").update(readFileSync(output)).digest("hex"),
    sourceSha256: createHash("sha256").update(readFileSync(source)).digest("hex"),
  }, null, 2) + "\n");
  console.log(`Built Linux ${process.arch} ownership helper.`);
} finally { rmSync(temporary, { force: true }); }
