import ts from "typescript";
import path from "node:path";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import type { Coverage, FileSnapshot, SourceRef, SymbolBody } from "../contracts.js";
import { digest, stableId } from "../domain/json.js";
import { sourceRef } from "../source/positions.js";
import { glob, globVersion } from "../source/policy.js";

export interface ParsedSymbol { id: string; path: string; name: string; body: SymbolBody; sourceRef: SourceRef; contextHash: string }
export interface ParsedWorkspace {
  contextHash: string; symbols: ParsedSymbol[]; parseErrors: Set<string>; gaps: Coverage["gaps"];
  definitions(symbolId: string): SourceRef[]; references(symbolId: string): SourceRef[]; dispose(): void;
}
const supported = /\.(?:ts|tsx|js|jsx)$/i;
const slash = (value: string) => value.replaceAll("\\", "/");
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const canonical = (value: string) => process.platform === "win32" ? slash(value).toLowerCase() : slash(value);
const libraryRoot = path.dirname(createRequire(import.meta.url).resolve("typescript"));
const libraries = new Map<string, { text: string; hash: string }>();
function standardLibrary(name: string) {
  if (canonical(path.dirname(name)) !== canonical(libraryRoot) || !/^lib(?:\.[\w-]+)*\.d\.ts$/.test(path.basename(name))) return undefined;
  if (!libraries.has(name)) {
    try { const text = readFileSync(name, "utf8"); libraries.set(name, { text, hash: digest(text) }); } catch { return undefined; }
  }
  return libraries.get(name);
}

/** Only the authorized snapshot and the product's locked TypeScript standard library are readable. */
export function parseWorkspace(root: string, workspaceId: string, files: Map<string, FileSnapshot>, policyHash: string): ParsedWorkspace {
  const absolute = new Map([...files].map(([relative, file]) => [canonical(path.resolve(root, relative)), file]));
  const fileAt = (name: string) => absolute.get(canonical(name));
  const configReads = new Map<string, string>();
  const gaps: Coverage["gaps"] = [], parseErrors = new Set<string>();
  const gapCodes = new Set<string>();
  const gap = (code: string, description: string) => { if (!gapCodes.has(code)) { gapCodes.add(code); gaps.push({ code, description }); } };
  const configHost: ts.ParseConfigFileHost = {
    useCaseSensitiveFileNames: process.platform !== "win32", getCurrentDirectory: () => root,
    fileExists: name => !!fileAt(name), readFile: name => { const file = fileAt(name); if (file) configReads.set(file.path, file.contentHash); return file?.text; },
    readDirectory: (directory, extensions, excludes, includes, depth) => {
      const match = (pattern: string, candidate: string) => {
        const expanded = pattern.endsWith("/**") ? `${pattern}/*` : !/[?*]/.test(pattern) && !/\.[^/]+$/.test(pattern) ? `${pattern}/**/*` : pattern;
        const relativePattern = slash(path.relative(root, path.resolve(directory, expanded)));
        try { return glob(relativePattern).test(candidate); } catch { return false; }
      };
      return [...absolute].filter(([name, file]) => {
        const relative = slash(path.relative(directory, name));
        return (!extensions || extensions.some(ext => name.endsWith(ext))) && (depth === undefined || relative.split("/").length <= depth + 1)
          && (includes ?? ["**/*"]).some(p => match(slash(p), file.path)) && !excludes?.some(p => match(slash(p), file.path));
      }).map(([name]) => name);
    },
    onUnRecoverableConfigFileDiagnostic: () => gap("config_unresolved", "存在无法解析的项目配置；该上下文只提供部分导航。"),
  };
  const configs = [...files.keys()].filter(name => /(?:^|\/)(?:tsconfig|jsconfig)(?:\.[^/]+)?\.json$/i.test(name)).sort(compare);
  const projects: { key: string; names: string[]; options: ts.CompilerOptions }[] = [];
  for (const config of configs) {
    try {
      const parsed = ts.getParsedCommandLineOfConfigFile(path.resolve(root, config), {}, configHost);
      if (!parsed) continue;
      if (parsed.errors.length) gap("config_unresolved", "存在无法解析的配置或配置继承；导航结果不完整。");
      for (const reference of parsed.projectReferences ?? []) {
        const name = reference.path.endsWith(".json") ? reference.path : path.join(reference.path, "tsconfig.json");
        if (!fileAt(name)) gap("project_reference_unresolved", "项目引用超出允许快照或无法解析。");
      }
      if (Array.isArray(parsed.options.plugins) && parsed.options.plugins.length) gap("plugins_disabled", "索引不执行TypeScript配置插件。");
      projects.push({ key: config, names: parsed.fileNames.filter(name => fileAt(name) && supported.test(name)), options: { ...parsed.options, plugins: [], noEmit: true, types: [], skipLibCheck: true } });
    } catch { gap("config_unresolved", "项目配置无法解析；已保留当前文本。"); }
  }
  const included = new Set(projects.flatMap(project => project.names.map(canonical)));
  const loose = [...absolute.keys()].filter(name => supported.test(name) && !included.has(name));
  if (loose.length) projects.push({ key: "inferred", names: loose, options: { allowJs: true, checkJs: false, jsx: ts.JsxEmit.Preserve, target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext, noEmit: true, types: [] } });
  const libraryReads = new Map<string, string>();
  const read = (name: string) => {
    const file = fileAt(name); if (file) return file.text;
    const lib = standardLibrary(name);
    if (lib) libraryReads.set(path.basename(name), lib.hash);
    return lib?.text;
  };
  const services: ts.LanguageService[] = [];
  const symbols: ParsedSymbol[] = [];
  const navigation = new Map<string, { service: ts.LanguageService; file: string; position: number }[]>();
  for (const project of projects) {
    const host: ts.LanguageServiceHost = {
      getCompilationSettings: () => project.options,
      getScriptFileNames: () => project.names, getScriptVersion: name => fileAt(name)?.contentHash ?? standardLibrary(name)?.hash ?? "missing",
      getScriptSnapshot: name => { const text = read(name); return text !== undefined ? ts.ScriptSnapshot.fromString(text) : undefined; },
      getCurrentDirectory: () => root, getDefaultLibFileName: options => ts.getDefaultLibFilePath(options),
      useCaseSensitiveFileNames: () => process.platform !== "win32", fileExists: name => !!fileAt(name) || !!standardLibrary(name), readFile: read,
      readDirectory: (directory, extensions, excludes, includes, depth) => [...configHost.readDirectory(directory, extensions ?? [], excludes, includes ?? ["**/*"], depth)],
      directoryExists: directory => { const prefix = canonical(directory) + "/"; return [...absolute.keys()].some(name => name.startsWith(prefix)); },
      realpath: name => name,
    };
    const service = ts.createLanguageService(host, ts.createDocumentRegistry(process.platform !== "win32", root));
    services.push(service);
    const program = service.getProgram();
    if (!program) continue;
    for (const name of project.names) {
      const file = fileAt(name), source = program.getSourceFile(name);
      if (!file || !source) continue;
      if (program.getSyntacticDiagnostics(source).length) { parseErrors.add(file.path); gap("parse_error", "部分文件含语法错误；保留文本但不复用旧解析。" ); continue; }
      if (program.getSemanticDiagnostics(source).some(d => [2307, 7016, 2688].includes(d.code))) gap("external_types_unresolved", "部分外部类型或模块无法在授权工作区内解析，静态导航不完整。");
      if (project.options.noLib || program.getGlobalDiagnostics().length) gap("standard_library_unresolved", "当前项目的标准库类型不完整，静态导航可能缺失。");
      const candidates: { node: ts.Node; label: string; key: string; position: number }[] = [];
      const visit = (node: ts.Node, parents: string[]) => {
        let label: string | null = null, nameNode: ts.Node | undefined;
        if (ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node) || ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node) || ts.isEnumDeclaration(node) || ts.isModuleDeclaration(node) || ts.isMethodDeclaration(node) || ts.isMethodSignature(node) || ts.isPropertyDeclaration(node) || ts.isPropertySignature(node) || ts.isGetAccessorDeclaration(node) || ts.isSetAccessorDeclaration(node) || ts.isVariableDeclaration(node)) {
          nameNode = node.name; label = nameNode?.getText(source) ?? "default";
        } else if (ts.isConstructorDeclaration(node)) label = "constructor";
        else if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) {
          const owner = node.parent;
          label = ts.isVariableDeclaration(owner) ? `${owner.name.getText(source)}:lambda` : ts.isCallExpression(owner) ? `${owner.expression.getText(source)}:callback` : "anonymous";
        }
        const next = label ? [...parents, label] : parents;
        if (label) {
          const kind = ts.SyntaxKind[node.kind];
          // Overload declarations are distinguished by signature, never line/ordinal.
          const signature = ts.isFunctionDeclaration(node) && !node.body ? node.getText(source).replace(/\s+/g, " ") : null;
          const key = digest({ path: file.path, parents, kind, label, signature });
          candidates.push({ node, label: next.join("."), key, position: nameNode?.getStart(source) ?? node.getStart(source) });
        }
        ts.forEachChild(node, child => visit(child, next));
      };
      visit(source, []);
      const occurrences = new Map<string, number>();
      for (const candidate of candidates) occurrences.set(candidate.key, (occurrences.get(candidate.key) ?? 0) + 1);
      for (const candidate of candidates) {
        const ambiguity = (occurrences.get(candidate.key) ?? 0) > 1;
        // Ambiguous identities are tied to this exact file version, never silently relocated.
        const naturalKey = ambiguity ? digest({ key: candidate.key, hash: file.contentHash, offset: candidate.node.getStart(source) }) : candidate.key;
        const ref = sourceRef(workspaceId, file.path, file.contentHash, file.text, candidate.node.getStart(source), candidate.node.getEnd());
        const id = stableId("sym", naturalKey);
        if (!navigation.has(id)) symbols.push({ id, path: file.path, name: candidate.label, contextHash: "", sourceRef: ref,
          body: { kind: "symbol", qualifiedName: candidate.label, declarationKind: ts.SyntaxKind[candidate.node.kind], sourceRefId: ref.id, naturalKey, ambiguity } });
        navigation.set(id, [...(navigation.get(id) ?? []), { service, file: name, position: candidate.position }]);
      }
    }
  }
  const contextHash = digest({ parser: `typescript/${ts.version}`, policyHash, globVersion, configs: [...configReads].sort(([a], [b]) => compare(a, b)), packages: [...files.values()].filter(file => /(?:^|\/)package\.json$/i.test(file.path)).map(file => [file.path, file.contentHash]).sort(([a], [b]) => compare(a, b)), libraries: [...libraryReads].sort(([a], [b]) => compare(a, b)), projects: projects.map(p => ({ key: p.key, options: JSON.parse(JSON.stringify(p.options)) })) });
  for (const symbol of symbols) symbol.contextHash = contextHash;
  if ([...navigation.values()].some(contexts => contexts.length > 1)) gap("multiple_project_contexts", "部分声明被多个项目配置包含；导航合并这些已授权上下文，不推断唯一运行配置。");
  if ([...files.values()].some(file => file.category === "code" && !supported.test(file.path))) gap("text_only_language", "不支持语义解析的语言仅提供文本证据。");
  const navigate = (id: string, references: boolean): SourceRef[] => {
    const contexts = navigation.get(id); if (!contexts) return [];
    const values = contexts.flatMap<ts.DocumentSpan>(at => (references ? at.service.getReferencesAtPosition(at.file, at.position) : at.service.getDefinitionAtPosition(at.file, at.position)) ?? []);
    const result = new Map<string, SourceRef>();
    for (const value of values ?? []) {
      const file = fileAt(value.fileName); if (!file) continue;
      try { const ref = sourceRef(workspaceId, file.path, file.contentHash, file.text, value.textSpan.start, value.textSpan.start + value.textSpan.length); result.set(ref.id, ref); } catch { /* Malformed spans cannot become evidence. */ }
    }
    return [...result.values()].sort((a, b) => compare(a.path, b.path) || a.range.start.line - b.range.start.line || a.range.start.character - b.range.start.character);
  };
  return { contextHash, symbols, parseErrors, gaps, definitions: id => navigate(id, false), references: id => navigate(id, true), dispose: () => services.forEach(service => service.dispose()) };
}
