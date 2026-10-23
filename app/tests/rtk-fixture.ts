import { createHash } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RtkDownload } from "../src/server/integrations/rtk-install.js";
import { rtkTarget } from "../src/server/integrations/rtk-install.js";
import type { RtkRun } from "../src/server/integrations/rtk-process.js";
export function rtkFixture() {
  const root = mkdtempSync(join(tmpdir(), "axiom-rtk-test-"));
  let version = "1.0.1", corrupt = false, held = false, release!: () => void;
  const calls: string[][] = [], archive = Buffer.from("fixture archive");
  const download: RtkDownload = async (url, signal) => {
    signal.throwIfAborted();
    const asset = `rtk-oss-${rtkTarget()}`, base = `https://github.com/rtk-ai/rtk/releases/download/v${version}/`;
    if (url.includes("api.github.com")) return Buffer.from(JSON.stringify({ tag_name: `v${version}`, assets: [asset, "checksums.txt"].map(name => ({ name, browser_download_url: base + name })) }));
    if (held) await new Promise<void>((resolve, reject) => {
      const abort = () => { signal.removeEventListener("abort", abort); reject(Error("cancelled")); };
      signal.addEventListener("abort", abort, { once: true }); release = () => { signal.removeEventListener("abort", abort); resolve(); };
    });
    return url.endsWith("checksums.txt") ? Buffer.from(`${corrupt ? "0".repeat(64) : createHash("sha256").update(archive).digest("hex")}  ${asset}\n`) : archive;
  };
  const run: RtkRun = async (_file, args, options) => {
    options.signal?.throwIfAborted(); calls.push(args);
    if (args[0] === "-tf") return Buffer.from(`${process.platform === "win32" ? "rtk.exe" : "rtk"}\nLICENSE\n`);
    if (args[0] === "-xOf") return Buffer.from("fixture program or license");
    if (args[0] === "--version") return Buffer.from(`rtk ${version}\n`);
    if (args.includes("--passthrough")) return Buffer.from(options.input!);
    return Buffer.from("80 files\n  file-0.ts\n");
  };
  return { root, download, run, calls, setVersion: (next: string) => { version = next; }, corrupt: () => { corrupt = true; }, hold: () => { held = true; }, release: () => { held = false; release?.(); } };
}
