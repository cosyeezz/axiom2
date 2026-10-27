import { buildSync } from "esbuild";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

// Exercise the real renderer in Node while leaving browser-only assets to UI checks.
// Keep packages external so React hooks and react-dom/server share one React instance.
const bundle = buildSync({
  stdin: {
    contents: 'export { Markdown } from "./Markdown.tsx"; export { DerivedContext } from "./derived-cache.ts";',
    resolveDir: fileURLToPath(new URL("../src/client/chat/", import.meta.url)), sourcefile: "markdown-fixture.ts",
  },
  bundle: true, write: false, format: "cjs", platform: "node", packages: "external",
  loader: { ".css": "empty", ".svg": "text" },
});
const module = { exports: {} as {
  Markdown: typeof import("../src/client/chat/Markdown.js").Markdown;
  DerivedContext: typeof import("../src/client/chat/derived-cache.js").DerivedContext;
} };
new Function("require", "module", "exports", bundle.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
export const { Markdown, DerivedContext } = module.exports;
