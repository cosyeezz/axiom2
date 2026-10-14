import { spawn } from "node:child_process";
import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { windowsOpenSource } from "./open-dialog-scripts.js";

/** Per-service private build directory. No project code, shared executable cache or persistent process. */
export class WindowsOpenHost {
  private pending?: Promise<{ file: string; args: string[] }>;
  private directory?: string;
  private readonly controller = new AbortController();
  private closed = false;

  prepare() {
    if (this.closed) return Promise.reject(Error("Native host closed"));
    return this.pending ??= this.build().catch((error) => { this.pending = undefined; throw error; });
  }

  private async build() {
    const signal = this.controller.signal;
    try {
      signal.throwIfAborted();
      // Use the OS framework compiler by absolute path, never an executable in the workspace/PATH.
      const framework = process.arch === "ia32" ? "Framework" : "Framework64";
      const compiler = join(process.env.SystemRoot || "C:\\Windows", "Microsoft.NET", framework, "v4.0.30319", "csc.exe");
      await access(compiler);
      this.directory = await mkdtemp(join(tmpdir(), "axiom-open-host-"));
      const source = join(this.directory, "Open.cs"), executable = join(this.directory, "AxiomOpen.exe");
      await writeFile(source, "\uFEFF" + windowsOpenSource, { encoding: "utf8", mode: 0o600 });
      signal.throwIfAborted();
      await new Promise<void>((resolve, reject) => {
        const child = spawn(compiler, ["/nologo", "/target:winexe", "/optimize+", "/utf8output", "/reference:System.Web.Extensions.dll", `/out:${executable}`, source], {
          windowsHide: true, shell: false, stdio: ["ignore", "pipe", "pipe"],
        });
        let failure: unknown, bytes = 0;
        const terminate = () => { if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL"); };
        const abort = () => { failure = signal.reason; terminate(); };
        const timer = setTimeout(() => { failure = Error("Native host compilation timed out"); terminate(); }, 30_000);
        timer.unref();
        const collect = (chunk: Buffer) => {
          bytes += chunk.length;
          if (bytes > 1024 * 1024) { failure = Error("Native compiler output exceeded limit"); terminate(); }
        };
        child.stdout.on("data", collect); child.stderr.on("data", collect);
        child.once("error", (error) => { failure = error; });
        process.once("exit", terminate);
        signal.addEventListener("abort", abort, { once: true });
        if (signal.aborted) abort();
        child.once("close", (code) => {
          clearTimeout(timer);
          process.removeListener("exit", terminate);
          signal.removeEventListener("abort", abort);
          if (failure) reject(failure);
          else if (code !== 0) reject(Error("Native host compilation failed"));
          else resolve();
        });
      });
      signal.throwIfAborted();
      await access(executable);
      return { file: executable, args: [] as string[] };
    } catch (error) {
      await this.remove();
      throw error;
    }
  }

  private async remove() {
    if (this.directory) await rm(this.directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    this.directory = undefined;
  }

  async close() {
    this.closed = true;
    this.controller.abort();
    await this.pending?.catch(() => {});
    await this.remove();
  }
}
