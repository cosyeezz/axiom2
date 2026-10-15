import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

// Publish an existing, successful native build without rebuilding its binaries.
const repo = process.env.GITHUB_REPOSITORY || "cosyeezz/axiom2";
assert.equal(repo, "cosyeezz/axiom2");
const runId = process.env.AXIOM_BUILD_RUN;
const tag = process.env.AXIOM_RELEASE_TAG;
assert.match(runId || "", /^\d+$/);
assert.match(tag || "", /^v\d+\.\d+\.\d+$/);
const gh = (...args) => execFileSync("gh", args, { encoding: "utf8", maxBuffer: 20 * 1024 * 1024, timeout: 120_000 });
const api = (path) => JSON.parse(gh("api", `repos/${repo}/${path}`));
const sha = (data) => createHash("sha256").update(data).digest("hex");
const run = api(`actions/runs/${runId}`);
assert.equal(run.path, ".github/workflows/desktop.yml");
assert.equal(run.event, "workflow_dispatch");
assert.equal(run.status, "completed");
assert.equal(run.conclusion, "success");
const source = api(`commits/${tag}`).sha;
const logs = gh("run", "view", runId, "--repo", repo, "--log");
assert.ok(logs.split("\n").some(line => line.includes("\tRecord source revision\t") && line.trimEnd().endsWith(` ${source}`)), "Build source does not match release tag");
const jobs = api(`actions/runs/${runId}/jobs`).jobs;
const job = jobs.find(job => job.name === "desktop (macos-latest)");
for (const name of ["Verify macOS disk image and universal application", "Smoke test macOS controller window"]) {
  assert.equal(job?.steps.find(step => step.name === name)?.conclusion, "success", name);
}
const artifact = api(`actions/runs/${runId}/artifacts`).artifacts.find(item => item.name === "Axiom2-macOS-universal");
assert.ok(artifact && !artifact.expired);
assert.match(artifact.digest, /^sha256:[a-f0-9]{64}$/);
assert.ok(artifact.size_in_bytes > 0 && artifact.size_in_bytes < 128 * 1024 * 1024);
const release = api(`releases/tags/${tag}`);
assert.equal(release.draft, false);
assert.equal(release.prerelease, false);
assert.ok(release.assets.some(asset => asset.name === "SHA256SUMS"));
console.log(`Verified build ${runId}, source ${source}, release ${tag}, artifact ${artifact.id}`);
if (!process.argv.includes("--publish")) process.exit(0);
assert.equal(process.platform, "darwin", "Publish on the macOS runner");
const directory = await mkdtemp(join(tmpdir(), "axiom-macos-publish-"));
try {
  const token = process.env.GH_TOKEN || gh("auth", "token").trim();
  const redirect = await fetch(`https://api.github.com/repos/${repo}/actions/artifacts/${artifact.id}/zip`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" },
    redirect: "manual", signal: AbortSignal.timeout(30_000),
  });
  assert.equal(redirect.status, 302);
  const location = new URL(redirect.headers.get("location"));
  assert.equal(location.protocol, "https:");
  const response = await fetch(location, { signal: AbortSignal.timeout(120_000) });
  assert.equal(response.status, 200);
  const archive = Buffer.from(await response.arrayBuffer());
  assert.equal(`sha256:${sha(archive)}`, artifact.digest);
  const zip = join(directory, "artifact.zip");
  await writeFile(zip, archive);
  const entries = execFileSync("/usr/bin/unzip", ["-Z1", zip], { encoding: "utf8" }).trim().split("\n").sort();
  assert.deepEqual(entries, ["Axiom2.dmg", "SHA256SUMS-macos"]);
  execFileSync("/usr/bin/ditto", ["-x", "-k", zip, directory]);
  const dmg = await readFile(join(directory, "Axiom2.dmg"));
  const macSum = `${sha(dmg)}  Axiom2.dmg\n`;
  assert.equal(await readFile(join(directory, "SHA256SUMS-macos"), "utf8"), macSum);
  gh("release", "download", tag, "--repo", repo, "--pattern", "SHA256SUMS", "--dir", directory);
  const previous = await readFile(join(directory, "SHA256SUMS"), "utf8");
  assert.equal(`sha256:${sha(Buffer.from(previous))}`, release.assets.find(asset => asset.name === "SHA256SUMS").digest);
  const lines = previous.trimEnd().split("\n");
  for (const line of lines) {
    const match = /^([a-f0-9]{64})  ([\w.-]+)$/.exec(line);
    assert.ok(match, "Invalid checksum line");
    assert.equal(release.assets.find(asset => asset.name === match[2])?.digest, `sha256:${match[1]}`);
  }
  const sums = lines.filter(line => !line.endsWith("  Axiom2.dmg")).join("\n") + "\n" + macSum;
  await writeFile(join(directory, "SHA256SUMS"), sums);
  const existing = release.assets.find(asset => asset.name === "Axiom2.dmg");
  if (existing) {
    assert.equal(existing.digest, `sha256:${sha(dmg)}`, "Refusing to replace a different DMG");
    assert.equal(existing.size, dmg.length);
  } else {
    gh("release", "upload", tag, join(directory, "Axiom2.dmg"), "--repo", repo);
  }
  gh("release", "upload", tag, join(directory, "SHA256SUMS"), "--repo", repo, "--clobber");
  const published = api(`releases/tags/${tag}`);
  assert.equal(published.assets.find(asset => asset.name === "Axiom2.dmg")?.digest, `sha256:${sha(dmg)}`);
  assert.equal(published.assets.find(asset => asset.name === "SHA256SUMS")?.digest, `sha256:${sha(Buffer.from(sums))}`);
  for (const asset of release.assets.filter(asset => asset.name !== "SHA256SUMS")) {
    assert.equal(published.assets.find(item => item.name === asset.name)?.digest, asset.digest);
  }
  assert.equal(api(`commits/${tag}`).sha, source);
  const evidence = { tag, source, runId, artifactId: artifact.id, artifactDigest: artifact.digest, dmg: { size: dmg.length, sha256: sha(dmg) }, checksums: sums };
  await writeFile("macos-publish.json", JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify(evidence));
} finally {
  await rm(directory, { recursive: true, force: true });
}
