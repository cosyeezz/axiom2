// Checks the actual Rust allowlist and reproduces its WKWebView subframe behavior.
// Run from app: ./node_modules/.bin/tsx tests/desktop-html-preview.check.ts
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);
const app = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const temp = await mkdtemp(join(tmpdir(), "axiom-wk-preview-"));
const artifacts = resolve(process.env.AXIOM_TEST_ARTIFACTS || join(app, "test-results/desktop-html-preview"));
await mkdir(artifacts, { recursive: true });
try {
  const views = await readFile(join(app, "desktop/axiom_views.rs"), "utf8");
  const policy = views.match(/fn allow_workbench_navigation\(same_origin: bool, url: &str\) -> bool \{[^}]+\}/)?.[0];
  assert.ok(policy, "Extract the actual dependency-free Rust navigation predicate");
  assert.match(views, /\.on_navigation\(move \|url\| allow_workbench_navigation\(url\.origin\(\) == origin, url\.as_str\(\)\)\)/);
  // The native harness below deliberately mirrors only this exact two-case rule.
  assert.match(policy, /\{\s*same_origin \|\| url == "about:srcdoc"\s*\}/);
  const rustTests = `${policy}
#[test] fn navigation_policy() {
    assert!(allow_workbench_navigation(true, "http://127.0.0.1:4317/"));
    assert!(allow_workbench_navigation(false, "about:srcdoc"));
    for denied in ["about:blank", "about:srcdoc?x", "about:srcdoc#x", "about:config", "data:text/html,hi", "blob:http://127.0.0.1:4317/id", "file:///etc/passwd", "javascript:alert(1)", "https://example.invalid/", "http://127.0.0.1:4318/"] {
        assert!(!allow_workbench_navigation(false, denied), "must reject {}", denied);
    }
}`;
  await writeFile(join(temp, "policy.rs"), rustTests);
  await run("rustc", ["--test", join(temp, "policy.rs"), "-o", join(temp, "policy-test")]);
  const rust = await run(join(temp, "policy-test"));
  await writeFile(join(artifacts, "rust-policy.log"), rust.stdout + rust.stderr);
  console.log("PASS actual Rust allowlist: same origin and exact about:srcdoc only.");

  if (process.platform !== "darwin") {
    console.log("SKIP system WKWebView probe (macOS only).");
  } else {
    const source = await readFile(join(app, "src/client/chat/HtmlFile.tsx"), "utf8");
    const csp = source.match(/const offlinePolicy = "([^"]+)"/)?.[1];
    assert.ok(csp);
    assert.ok(csp.includes("frame-src 'none'"), "Keep the strict frame CSP");
    // Self-contained fixture: publishing must not depend on ignored local galleries.
    const gallery = `<!doctype html><html><head><title>Isolated SVG preview</title><style>body{display:grid;grid-template-columns:repeat(10,1fr);gap:8px}.card{padding:12px;background:#edf1f5}svg{width:32px;height:32px}</style></head><body>${Array.from({ length: 50 }, (_, index) => `<div class="card"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M3 7V4h6l2 3h10v13H3z"/></svg><span>${index + 1}</span></div>`).join("")}</body></html>`;
    const text = gallery.replace("</body>", `<script>window.top.postMessage({cards:document.querySelectorAll('.card').length,title:document.title},'*')</script></body>`);
    const escape = (value: string) => value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;");
    const header = `<meta http-equiv="Content-Security-Policy" content="${csp}"><meta name="referrer" content="no-referrer">`;
    const doc = `<!doctype html>${header}${text}`;
    const wrapper = `<!doctype html>${header}<style>html,body{margin:0;width:100%;height:100%;overflow:hidden}iframe{display:block;width:100%;height:100%;border:0}</style><iframe sandbox="allow-scripts" srcdoc="${escape(doc)}"></iframe>`;
    const host = `<!doctype html><script>window.__reports=[];addEventListener('message',e=>window.__reports.push(e.data))</script><iframe style="width:100%;height:750px;border:0" sandbox="allow-scripts" srcdoc="${escape(wrapper)}"></iframe><iframe hidden src="https://example.invalid/"></iframe><iframe hidden src="http://127.0.0.1:4318/"></iframe>`;
    const hostPath = join(temp, "host.html");
    await writeFile(hostPath, host);
    await run("swiftc", [join(app, "tests/desktop-html-preview.swift"), "-o", join(temp, "probe")], { timeout: 60000 });
    for (const allowed of [false, true]) {
      const prefix = join(artifacts, allowed ? "fixed" : "before");
      await run(join(temp, "probe"), [hostPath, prefix, ...(allowed ? ["--allow-srcdoc"] : [])], { timeout: 20000 });
      const report = JSON.parse(await readFile(`${prefix}.json`, "utf8"));
      assert.equal(report.error, "");
      assert.equal(report.snapshotError, "");
      const navigations = report.navigations as Array<{ url: string; allowed: boolean; main: boolean }>;
      assert.ok(navigations.some((item) => item.url === "about:srcdoc" && !item.main && item.allowed === allowed));
      for (const target of ["https://example.invalid/", "http://127.0.0.1:4318/"]) {
        assert.ok(navigations.some((item) => item.url === target && !item.allowed), `Still denies ${target}`);
      }
      const renders = JSON.parse(report.renderReports);
      if (allowed) {
        assert.equal(navigations.filter((item) => item.url === "about:srcdoc" && item.allowed).length, 2);
        assert.equal(renders.length, 1);
        assert.equal(renders[0].cards, 50);
      } else {
        assert.equal(renders.length, 0, "Original desktop filter reproduces the white preview");
      }
    }
    console.log(`PASS system WKWebView: old filter blocks preview, exact srcdoc fix renders 50 icons; cross-origin blocked. Artifacts: ${artifacts}`);
  }
} finally {
  await rm(temp, { recursive: true, force: true });
}
