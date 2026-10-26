// Client modules import Vite assets. Node tests load stylesheets as empty modules and `?raw` files as text.
import { register } from "node:module";

const hooks = `
import { readFile } from "node:fs/promises";
export async function load(url, context, next) {
  if (!url.startsWith("file:")) return next(url, context);
  const file = new URL(url);
  const raw = file.searchParams.has("raw");
  file.search = ""; file.hash = "";
  if (raw) return { format: "module", shortCircuit: true, source: "export default " + JSON.stringify(await readFile(file, "utf8")) };
  if (file.pathname.endsWith(".css")) return { format: "module", shortCircuit: true, source: "" };
  return next(url, context);
}`;
register("data:text/javascript," + encodeURIComponent(hooks));
