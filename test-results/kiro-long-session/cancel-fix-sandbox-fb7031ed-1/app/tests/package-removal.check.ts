import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium, type Browser } from "playwright";
import { startServer } from "../src/server/index.js";
import { commitPiPackage, listPiPackageRemovals, piPackagePlan } from "../src/server/pi-package-storage.js";

const root = mkdtempSync(join(tmpdir(), "axiom-package-removal-ui-")), agentDir = join(root, "pi"), source = join(root, "fixture-pending");
const artifacts = resolve(process.env.AXIOM_TEST_ARTIFACTS ?? "test-results/package-removal");
for (const path of [agentDir, source, artifacts]) mkdirSync(path, { recursive: true });
writeFileSync(join(source, "package.json"), JSON.stringify({ name: "fixture-pending", version: "1.0.0" }));
writeFileSync(join(source, "keep.txt"), "external source preserved");
writeFileSync(join(agentDir, "settings.json"), JSON.stringify({ packages: [source] }));
const request = { action: "remove" as const, source, cwd: root, agentDir, local: false };
let app: Awaited<ReturnType<typeof startServer>> | undefined, browser: Browser | undefined;
try {
  await commitPiPackage(request, piPackagePlan(request).initialIdentity, new AbortController().signal);
  app = await startServer({ root, port: 0, dev: true, openCli: { locateNpm: () => { throw Error("UI fixture: npm unavailable"); } } });
  browser = await chromium.launch({ executablePath: process.env.AXIOM_TEST_BROWSER, headless: true });
  const page = await browser.newPage(), errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(`${app.origin}/resources.html`);
  const cleanup = page.getByRole("button", { name: "继续清理", exact: true });
  await cleanup.waitFor();
  assert.equal(await page.getByRole("button", { name: "更新资源包", exact: true }).count(), 0);
  assert.equal(await page.getByRole("alert").count(), 0);
  assert.match(await page.locator(".resources-facts").innerText(), /pi 资源包/);
  for (const theme of ["dark", "light"]) {
    await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme);
    for (const width of [320, 390, 1200]) {
      await page.setViewportSize({ width, height: 900 });
      await cleanup.scrollIntoViewIfNeeded();
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `overflow ${theme}/${width}`);
      await page.screenshot({ path: join(artifacts, `package-pending-${theme}-${width}.png`), fullPage: true });
    }
  }
  await cleanup.click();
  const dialog = page.getByRole("dialog");
  await dialog.waitFor();
  assert.match(await dialog.innerText(), /外部共享源文件保留/);
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "hidden" });
  assert.equal(listPiPackageRemovals(request).length, 1);
  await cleanup.click();
  await dialog.getByRole("button", { name: "取消", exact: true }).click();
  assert.equal(listPiPackageRemovals(request).length, 1);
  await page.reload(); await cleanup.waitFor();
  await cleanup.click();
  await dialog.getByRole("button", { name: "确认清理", exact: true }).click();
  await cleanup.waitFor({ state: "hidden" });
  assert.deepEqual(listPiPackageRemovals(request), []);
  assert.equal(readFileSync(join(source, "keep.txt"), "utf8"), "external source preserved");
  assert.ok(existsSync(join(source, "package.json")));
  assert.deepEqual(JSON.parse(readFileSync(join(agentDir, "settings.json"), "utf8")).packages, []);
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: true, artifacts, cases: ["pending rediscovery", "update hidden", "dark/light 320/390/1200", "Escape and cancel preserve pending", "reload preserves pending", "confirmed cleanup preserves external files"] }));
} finally {
  await browser?.close();
  await app?.close();
  rmSync(root, { recursive: true, force: true });
}
