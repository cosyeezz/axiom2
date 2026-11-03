import { Worker } from "node:worker_threads";
import { webReadLimits as limits } from "../../shared/web-read.js";
import { checkAbort, WebReadError } from "./errors.js";

export interface ExtractedPage { title: string; content: string; complete: boolean }
export async function extractPage(html: string, url: string, signal: AbortSignal): Promise<ExtractedPage> {
  checkAbort(signal);
  const source = import.meta.url.endsWith(".ts");
  const file = new URL(source ? "./extract-worker.ts" : "./extract-worker.js", import.meta.url);
  const entry = source ? new URL(`data:text/javascript,${encodeURIComponent(
    `import { register } from ${JSON.stringify(import.meta.resolve("tsx/esm/api"))}; register(); await import(${JSON.stringify(file.href)});`,
  )}`) : file;
  const worker = new Worker(entry, { workerData: { html, url },
    execArgv: process.execArgv.filter(value => !value.startsWith("--input-type")),
    resourceLimits: { maxOldGenerationSizeMb: 128, maxYoungGenerationSizeMb: 16, stackSizeMb: 4 },
    stdout: true, stderr: true });
  // Parser diagnostics can contain private page content. Drain without logging.
  worker.stdout.resume(); worker.stderr.resume();
  try {
    return await new Promise<ExtractedPage>((resolve, reject) => {
      const abort = () => { try { checkAbort(signal); } catch (error) { finish(error); } };
      let settled = false;
      const finish = (error?: unknown, result?: ExtractedPage) => {
        if (settled) return;
        settled = true; clearTimeout(timer); signal.removeEventListener("abort", abort);
        error ? reject(error) : resolve(result!);
      };
      const timer = setTimeout(() => finish(new WebReadError("EXTRACTION_TIMEOUT", "Local extraction exceeded its time limit.", true)), limits.parseMs);
      signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) abort();
      worker.once("error", () => finish(new WebReadError("EXTRACTION_FAILED", "Local extraction worker failed.")));
      worker.once("exit", () => finish(new WebReadError("EXTRACTION_FAILED", "Local extraction worker exited before returning a document.")));
      worker.once("message", (value) => {
        if (signal.aborted) { abort(); return; }
        if (value?.ok === true && typeof value.content === "string" && value.content.length <= limits.documentChars && typeof value.title === "string")
          finish(undefined, { content: value.content, title: value.title, complete: value.complete === true });
        else {
          const codes = ["VERIFICATION_REQUIRED", "AUTH_REQUIRED", "NEEDS_BROWSER", "EXTRACTION_FAILED"];
          const code = codes.includes(value?.code) ? value.code : "EXTRACTION_FAILED";
          finish(new WebReadError(code, "The page could not be read as a public static document. Browser verification/login is not enabled for this tool."));
        }
      });
    });
  } finally { await worker.terminate(); }
}
