import assert from "node:assert/strict";
import { isBuiltin } from "node:module";
import { resolve } from "node:path";
import { build } from "esbuild";

export async function nativeProviderBundle() {
  const bundle = await build({ entryPoints: [resolve("src/native-providers/index.ts")], bundle: true, platform: "node", format: "esm",
    external: ["kerberos"], banner: { js: 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);' }, write: false, metafile: true });
  const inputs = Object.keys(bundle.metafile!.inputs);
  // The existing native sender's declared proxy dependency and its transitive closure only.
  assert.ok(inputs.every(path => path.startsWith("src/native-providers/") || /^node_modules\/(?:https-proxy-agent|proxy-agent-negotiate|agent-base|debug|ms)\//.test(path)), JSON.stringify(inputs));
  const external = Object.values(bundle.metafile!.outputs).flatMap(output => output.imports).filter(item => item.external);
  assert.ok(external.every(item => isBuiltin(item.path) || ["kerberos", "supports-color"].includes(item.path)), JSON.stringify(external));
  return bundle.outputFiles[0].text;
}
