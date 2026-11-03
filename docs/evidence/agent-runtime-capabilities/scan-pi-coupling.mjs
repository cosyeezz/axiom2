#!/usr/bin/env node
// Static research inventory, not a product or integration test.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
const root = path.resolve(fileURLToPath(new URL("../../../", import.meta.url)));
const require = createRequire(path.join(root, "app/package.json"));
const ts = require("typescript");
function packageMetadata(name) {
  // Read metadata without requiring an unexported package.json or require-only entry.
  const candidate = path.join(root, "app/node_modules", name, "package.json");
  const metadata = JSON.parse(fs.readFileSync(candidate, "utf8"));
  if (metadata.name !== name) throw Error(`Unexpected installed package: ${name}`);
  return metadata;
}
const sourceRoot = path.join(root, "app/src");
const output = process.argv[2] ? path.resolve(process.argv[2]) : path.dirname(fileURLToPath(import.meta.url));
const excludedDirectories = new Set(["vite-cache", "node_modules", ".git"]);
const walk = dir => fs.readdirSync(dir, { withFileTypes: true }).sort((a,b) => a.name.localeCompare(b.name, "en")).flatMap(e => e.isDirectory() ? excludedDirectories.has(e.name) ? [] : walk(path.join(dir, e.name)) : [path.join(dir, e.name)]);
const allFiles = walk(sourceRoot);
const codeFiles = allFiles.filter(f => /\.(?:[cm]?[jt]sx?)$/.test(f));
const rel = f => path.relative(root, f).split(path.sep).join("/");
const sha256 = s => crypto.createHash("sha256").update(s).digest("hex");
const files = codeFiles.map(f => ({ path: rel(f), bytes: fs.statSync(f).size, sha256: sha256(fs.readFileSync(f)), lines: fs.readFileSync(f, "utf8").split("\n").length - (fs.readFileSync(f, "utf8").endsWith("\n") ? 1 : 0) }));
const program = ts.createProgram(codeFiles, { noResolve: true, noLib: true, allowJs: true, target: ts.ScriptTarget.ESNext, jsx: ts.JsxEmit.Preserve });
const checker = program.getTypeChecker();
const piPattern = /^@(?:earendil-works|mariozechner)\/pi-[^/]+(?:\/.*)?$/;
const pkg = s => s.split("/").slice(0,2).join("/");
const sites = [], bindings = [], privateModulePaths = [], computedResolutionSites = [], borrowedDependencies = [], localEdges = [], unresolvedLocalEdges = [];
const codeFileSet = new Set(codeFiles);
function resolveLocal(from, specifier) {
  if (!specifier.startsWith(".")) return;
  const base = path.resolve(path.dirname(from), specifier);
  const stem = base.replace(/\.(?:[cm]?js|jsx)$/, "");
  const candidates = [base, ...[".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"].flatMap(ext => [stem + ext, path.join(base, "index" + ext)])];
  return candidates.find(candidate => codeFileSet.has(candidate));
}
function typePosition(n) {
  for (let p = n.parent; p; p = p.parent) {
    if (ts.isTypeNode(p) || ts.isInterfaceDeclaration(p) || ts.isTypeAliasDeclaration(p)) return true;
    if (ts.isExpression(p) || ts.isStatement(p)) return false;
  }
  return false;
}
for (const f of codeFiles) {
  const sf = program.getSourceFile(f);
  const localBindings = new Map();
  const resolvedModuleVariables = new Map();
  function findResolvedVariables(n) {
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer && ts.isCallExpression(n.initializer) && n.initializer.expression.getText(sf) === "import.meta.resolve" && n.initializer.arguments[0] && ts.isStringLiteral(n.initializer.arguments[0]) && piPattern.test(n.initializer.arguments[0].text)) resolvedModuleVariables.set(n.name.text, n.initializer.arguments[0].text);
    ts.forEachChild(n, findResolvedVariables);
  }
  findResolvedVariables(sf);
  const loc = n => ({ file: rel(f), line: sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1 });
  function add(module, form, n, mode, bs = []) {
    const id = sites.length + 1;
    sites.push({ id, ...loc(n), module, package: pkg(module), form, mode });
    for (const b of bs) {
      const symbol = checker.getSymbolAtLocation(b.node);
      const record = { siteId: id, ...loc(b.node), imported: b.imported, local: b.node.text, mode: b.mode, references: [] };
      bindings.push(record);
      if (symbol) localBindings.set(symbol, record);
    }
  }
  function visit(n) {
    let localSpecifier, edgeForm;
    if ((ts.isImportDeclaration(n) || ts.isExportDeclaration(n)) && n.moduleSpecifier && ts.isStringLiteral(n.moduleSpecifier)) { localSpecifier = n.moduleSpecifier.text; edgeForm = ts.isImportDeclaration(n) ? "import" : "export"; }
    if (ts.isCallExpression(n) && n.expression.kind === ts.SyntaxKind.ImportKeyword && n.arguments[0] && ts.isStringLiteral(n.arguments[0])) { localSpecifier = n.arguments[0].text; edgeForm = "dynamic-import"; }
    if (ts.isNewExpression(n) && n.expression.getText(sf) === "URL" && n.arguments?.[0] && ts.isStringLiteral(n.arguments[0]) && n.arguments[1]?.getText(sf) === "import.meta.url") { localSpecifier = n.arguments[0].text; edgeForm = "url"; }
    if (localSpecifier?.startsWith(".")) {
      const resolved = resolveLocal(f, localSpecifier);
      const edge = { ...loc(n), specifier: localSpecifier, form: edgeForm };
      if (resolved) localEdges.push({ ...edge, target: rel(resolved) });
      else unresolvedLocalEdges.push(edge);
    }
    if (ts.isImportDeclaration(n) && ts.isStringLiteral(n.moduleSpecifier) && piPattern.test(n.moduleSpecifier.text)) {
      const c = n.importClause, bs = [];
      if (c?.name) bs.push({ node: c.name, imported: "default", mode: c.isTypeOnly ? "type" : "value" });
      if (c?.namedBindings && ts.isNamespaceImport(c.namedBindings)) bs.push({ node: c.namedBindings.name, imported: "*", mode: c.isTypeOnly ? "type" : "value" });
      if (c?.namedBindings && ts.isNamedImports(c.namedBindings)) for (const e of c.namedBindings.elements) bs.push({ node: e.name, imported: (e.propertyName ?? e.name).text, mode: c.isTypeOnly || e.isTypeOnly ? "type" : "value" });
      const modes = new Set(bs.map(b => b.mode));
      add(n.moduleSpecifier.text, "import", n, modes.size > 1 ? "mixed" : modes.has("type") ? "type" : "value", bs);
    }
    if (ts.isExportDeclaration(n) && n.moduleSpecifier && ts.isStringLiteral(n.moduleSpecifier) && piPattern.test(n.moduleSpecifier.text)) add(n.moduleSpecifier.text, "export", n, n.isTypeOnly ? "type" : "value");
    if (ts.isImportTypeNode(n) && ts.isLiteralTypeNode(n.argument) && ts.isStringLiteral(n.argument.literal) && piPattern.test(n.argument.literal.text)) add(n.argument.literal.text, "import-type", n, "type");
    if (ts.isCallExpression(n) && n.arguments[0] && ts.isStringLiteral(n.arguments[0]) && piPattern.test(n.arguments[0].text)) {
      const e = n.expression.getText(sf);
      const form = n.expression.kind === ts.SyntaxKind.ImportKeyword ? "dynamic-import" : e === "import.meta.resolve" ? "import-meta-resolve" : e === "require" ? "require" : null;
      if (form) add(n.arguments[0].text, form, n, "value");
    }
    if (ts.isCallExpression(n) && n.expression.getText(sf) === "import.meta.resolve" && n.arguments[0] && !ts.isStringLiteral(n.arguments[0])) computedResolutionSites.push({ ...loc(n), expression: n.getText(sf) });
    if (ts.isNewExpression(n) && n.expression.getText(sf) === "URL" && n.arguments?.[0] && ts.isStringLiteral(n.arguments[0]) && (n.arguments[1]?.getText(sf).includes("pi-coding-agent") || resolvedModuleVariables.has(n.arguments[1]?.getText(sf)))) privateModulePaths.push({ ...loc(n), relativePath: n.arguments[0].text, expression: n.getText(sf) });
    if (ts.isCallExpression(n) && ts.isCallExpression(n.expression) && n.expression.expression.getText(sf) === "createRequire" && n.arguments[0] && ts.isStringLiteral(n.arguments[0])) {
      const from = n.expression.arguments[0]?.getText(sf);
      if (from?.includes("pi-coding-agent") || resolvedModuleVariables.has(from)) borrowedDependencies.push({ ...loc(n), dependency: n.arguments[0].text, expression: n.getText(sf) });
    }
    ts.forEachChild(n, visit);
  }
  visit(sf);
  function refs(n) {
    if (ts.isIdentifier(n)) {
      const b = localBindings.get(checker.getSymbolAtLocation(n));
      if (b && !ts.isImportSpecifier(n.parent) && !ts.isImportClause(n.parent) && !ts.isNamespaceImport(n.parent)) {
        let access = n;
        while ((ts.isPropertyAccessExpression(access.parent) && access.parent.expression === access) || (ts.isNonNullExpression(access.parent) && access.parent.expression === access)) access = access.parent;
        const p = access.parent;
        const kind = ts.isCallExpression(p) && p.expression === access ? "call" : ts.isNewExpression(p) && p.expression === access ? "construct" : typePosition(n) ? "type" : "value";
        b.references.push({ ...loc(n), access: access.getText(sf), kind });
      }
    }
    ts.forEachChild(n, refs);
  }
  refs(sf);
}
const unique = xs => [...new Set(xs)].sort();
const coupledFiles = unique(sites.map(s => s.file));
const fileModes = coupledFiles.map(file => {
  const ss = sites.filter(s => s.file === file);
  const type = ss.some(s => s.mode !== "value"), value = ss.some(s => s.mode !== "type");
  return { file, mode: type && value ? "mixed" : value ? "value-only" : "type-only", sites: ss.length, packages: unique(ss.map(s => s.package)) };
});
const countBy = (xs, key) => Object.fromEntries(unique(xs.map(key)).map(k => [k, xs.filter(x => key(x) === k).length]));
const scopeCounts = {};
for (const area of ["server", "client", "shared"]) {
  const prefix = `app/src/${area}/`;
  const ff = files.filter(f => f.path.startsWith(prefix));
  scopeCounts[area] = { allFiles: allFiles.filter(f => rel(f).startsWith(prefix)).length, codeFiles: ff.length, lines: ff.reduce((s,f) => s+f.lines,0), coupledFiles: coupledFiles.filter(f => f.startsWith(prefix)).length };
}
const reachable = new Set(coupledFiles);
let changed = true;
while (changed) {
  changed = false;
  for (const e of localEdges) if (reachable.has(e.target) && !reachable.has(e.file)) { reachable.add(e.file); changed = true; }
}
const parseDiagnostics = codeFiles.flatMap(f => (program.getSourceFile(f).parseDiagnostics ?? []).map(d => ({ file: rel(f), code: d.code, start: d.start, message: ts.flattenDiagnosticMessageText(d.messageText, " ") })));
const summary = {
  head: execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(),
  piCodingAgentVersion: packageMetadata("@earendil-works/pi-coding-agent").version,
  scope: "Current working tree app/src only; TS/TSX/JS/JSX/MTS/CTS/MJS/CJS, tracked and untracked. Excludes vite-cache, node_modules, .git, tests and build trees outside app/src.",
  excludedDirectories: [...excludedDirectories],
  parseDiagnosticCount: parseDiagnostics.length,
  sourceManifestHash: sha256(files.map(f => `${f.path}\0${f.sha256}\n`).join("")),
  allSourceFiles: allFiles.length, codeFiles: codeFiles.length, codeLines: files.reduce((s,f) => s+f.lines,0), scopeCounts,
  coupledFiles: coupledFiles.length, sourceImportGraph: { localEdges: localEdges.length, unresolvedEdges: unresolvedLocalEdges.length, piReachableFiles: reachable.size, indirectlyReachableFiles: reachable.size - coupledFiles.length, reachableByArea: countBy([...reachable], f=>f.split("/")[2]) }, moduleSites: sites.length, siteForms: countBy(sites,s=>s.form), siteModes: countBy(sites,s=>s.mode), fileModes: countBy(fileModes,f=>f.mode),
  importedBindings: bindings.length, bindingModes: countBy(bindings,b=>b.mode), uniquePackageSymbols: unique(bindings.map(b=>`${sites[b.siteId-1].package}::${b.imported}`)).length,
  directCallConstructReferences: bindings.flatMap(b=>b.references).filter(r=>["call","construct"].includes(r.kind)).length,
  packages: unique(sites.map(s=>s.package)).map(packageName => { const ss=sites.filter(s=>s.package===packageName); const bb=bindings.filter(b=>sites[b.siteId-1].package===packageName); return { package: packageName, files: unique(ss.map(s=>s.file)).length, sites: ss.length, bindings: bb.length, uniqueSymbols: unique(bb.map(b=>b.imported)).length }; }),
  privateModulePaths: privateModulePaths.filter(p => /\.js$/.test(p.relativePath)),
  packageMetadataPaths: privateModulePaths.filter(p => /\.json$/.test(p.relativePath)),
  computedResolutionSites,
  borrowedDependencies,
  limitations: ["AST module-site and imported-binding counts are exact for this scope, not runtime call graph counts.","Type-only means explicitly declared type-only; a value binding may only be referenced in types.","Imported calls omit methods reached through session instances, transitive effects, reflection, computed modules and external resources.",
    "Source graph includes declared type-only imports and literal worker URLs; reachability is syntactic dependency, not executable call reachability. Unresolved edges include non-code assets.","No product tests, model requests, DSH execution, behavioral or performance validation."]
};
fs.mkdirSync(output,{ recursive: true });
fs.writeFileSync(path.join(output,"pi-coupling-inventory.json"), JSON.stringify({ summary, files, fileModes, sites, bindings, localEdges, unresolvedLocalEdges, parseDiagnostics, piReachableFiles: [...reachable].sort() },null,2)+"\n");
fs.writeFileSync(path.join(output,"pi-coupling-summary.json"), JSON.stringify(summary,null,2)+"\n");
console.log(JSON.stringify(summary,null,2));
