import { buildSync } from "esbuild";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

// Exercise the real renderer in Node while leaving browser-only assets to UI checks.
// Keep packages external so React hooks and react-dom/server share one React instance.
const bundle = buildSync({
  entryPoints: [fileURLToPath(new URL("../src/client/chat/Markdown.tsx", import.meta.url))],
  bundle: true, write: false, format: "cjs", platform: "node", packages: "external",
  loader: { ".css": "empty", ".svg": "text" },
});
const module = { exports: {} as { Markdown: typeof import("../src/client/chat/Markdown.js").Markdown } };
new Function("require", "module", "exports", bundle.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
export const Markdown = module.exports.Markdown;
