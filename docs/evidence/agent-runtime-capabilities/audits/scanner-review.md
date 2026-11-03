# Pi static scanner review

## Conclusion
Current-working-tree baseline independently corroborated: 94 files, 127 literal Pi module sites, 277 imported bindings, 100 package-qualified imported symbols. Static inventory only; no product tests/build/model requests were executed. No project files were modified by this review.

## Execution evidence
Working directory: `/Volumes/D_Work/axiom2`.

1. Actual scanner command:
   `node docs/evidence/agent-runtime-capabilities/scan-pi-coupling.mjs /tmp/axiom-runtime-scan-review > /tmp/axiom-runtime-scan-review/run.stdout.json 2> /tmp/axiom-runtime-scan-review/run.stderr.log`
   Actual program exit **0**, recorded in `run.exit`. stderr empty. Explicit output argument prevents default evidence artifact writes.
2. Independent command: `python3 - <<'PY'` (inline Python; no TypeScript API). Actual exit **0**, recorded in `text-check.exit`. Used os.walk with explicit excluded directory names, extension regex, quoted Pi-literal regex, multiline import-from regex, comma/alias/type clause parsing, and SHA256 comparisons. Assertions: literal file/module multisets equal scanner sites; binding tuples equal scanner bindings; code-file manifest set equal; source bytes unchanged since scanner manifest. Outputs `independent-text-check.json`, `raw-pi-literals.json`. Inline program was not persisted; command text is retained in delegated tool transcript.
3. Independent command: `python3 - <<'PY'` (inline Python). Actual exit **0**, recorded in `graph-check.exit`. Recomputed reverse graph fixed point, counted excluded cache files, sampled omitted local import-type, grouped unresolved edges, and hashed scanner. Output `graph-and-scope-check.json`. Inline program retained in tool transcript.

## Scope and counts
- 682 files / 600 code files / 64,393 code lines; server 269, client 259, shared 72 code files. All 94 direct Pi-coupled files are server-side.
- `app/src/client/vite-cache` actually exists: 218 files, 116 code files, **zero manifest entries**. Exclusion is name-based at every traversed depth (`vite-cache`, `node_modules`, `.git`). Root is only app/src, including tracked and untracked code, not repository-wide. Tests under app/src would be included; tests/build trees outside it are not scanned.
- Independent text scan: 127 quoted Pi modules in 94 files; file/module multisets exactly match inventory. 118 import declarations; remaining forms are 2 literal dynamic imports + 7 literal import.meta.resolve.
- Text-parsed 277 local import bindings exactly match scanner records: type 165, value 112. Import-only modes: type 62 / mixed 27 / value 29; all-site value count 38 includes 9 non-import sites. File modes: type-only 43 / mixed 30 / value-only 21.
- 100 means unique `(package, imported-name)`, not 100 locally named variables or methods; aliases collapse, default and namespace names would each collapse per package. Only import declaration bindings contribute; computed resolution/private imports have no imported binding records.
- `type` means explicit `import type` or `type` specifier, not inferred runtime erasure. A value import does not prove runtime execution.
- Manifest hash `1aa6d8ab246d0495ec17f2e1db3409d306241cc4604814cd722da63c53ad04aa`; all 600 byte hashes and file set matched independent read. Dirty/concurrently changing tree is not an atomic filesystem snapshot; this equality only verifies the observed interval.

## Source sampling / private paths
Reviewed source samples:
- app/src/server/axiom-prompt.ts:12 system-prompt.js
- app/src/server/capability-resources.ts:22 extensions/mcp/config.js
- app/src/server/pi-package-storage.ts:97,114 core/settings-manager.js
- app/src/server/pi-settings-storage.ts:18 core/settings-manager.js
- app/src/server/resources.ts:29,31,32 core/mcp-servers.js, core/auth-storage.js, extensions/mcp/oauth.js
Thus **8 sites / 6 distinct relative .js paths**, separate from the 127 literal package sites (the enclosing imports use URL expressions). Metadata path ../package.json at pi-settings-storage.ts:10 is counted separately, not a private JS module.
Borrowed dependencies independently read: proper-lockfile at pi-settings-storage.ts:12 and yaml at skill-import.ts:6 (**2**). Computed resolution at execution-profile.ts:37 (**1 syntax site**) iterates pi-coding-agent/pi-agent-core/pi-ai; not one runtime resolve or one package.

## AST / graph limitations and recommendations
- Program uses `noResolve:true`, `noLib:true`; zero parse diagnostics means syntactically parseable, not typechecked or product-correct. Literal matching supports only the two Pi scopes and recognized syntax; identifier aliases, template-literal module arguments, wrappers and generated/external resources are outside literal inventory.
- Graph has 2,247 declared local edges and 80 unresolved edges (71 CSS, 4 JSON, other assets/queries/docs). Independently recomputed reverse closure is 153 server files = 94 direct + 59 indirect. Not a runtime call graph; includes type-only declarations and worker URLs, ignores runtime conditions and direction of execution.
- Local import-type nodes are missing from localEdges: e.g. app/src/shared/agent.ts:100 `import("./skills.js").SkillReference`. `require`, aliases, package resolutions, arbitrary computed imports are not local graph edges. Therefore do not label closure complete transitive runtime coupling.
- Private/borrowed detection is heuristic: recognizes direct new URL and simple variables initialized by literal Pi import.meta.resolve; no dataflow, alias/scope/shadowing validation. ComputedResolutionSites records all non-string-literal import.meta.resolve calls, not necessarily Pi in a future source tree. .js filtering ignores alternate private file extensions.
- 155 direct call/construct references are imported-binding syntactic references, not invocation frequency or all Pi calls. Session instance methods and deeper dataflow are not resolved.
- Recommended documentation wording: “exact for recognized literal syntax in this manifest,” “syntactic reverse dependency closure,” “explicit type-only,” “8 private-path syntax occurrences / 6 distinct module paths.”

## Unverified / errors
No scanner or independent-check errors observed. Package export availability, borrowed dependency execution, private module loading, semantic type diagnostics, product behavior and performance were NOT tested. No SDK README/API validation needed for these source-statistics assertions; this review does not validate Pi APIs.
