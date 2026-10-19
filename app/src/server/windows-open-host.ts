import { spawn, type ChildProcess, type ChildProcessWithoutNullStreams } from "node:child_process";
import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { windowsOpenSource } from "./open-dialog-scripts.js";
import { windowsExplorerSource } from "./windows-explorer-source.js";

/** Per-service private build and one prewarmed, single-use STA process; no shared executable cache. */
export class WindowsOpenHost {
  private pending?: Promise<{ file: string; args: string[] }>;
  private directory?: string;
  private standby?: { child: ChildProcess; ready: Promise<void> };
  private readonly children = new Map<ChildProcess, Promise<void>>();
  private readonly controller = new AbortController();
  private buildController?: AbortController;
  private recoveryRemaining = 1;
  private readonly expectedExits = new WeakSet<ChildProcess>();
  private closed = false;

  constructor(private readonly mode: "dialog" | "explorer" = "dialog",
    private readonly launch: (file: string) => ChildProcessWithoutNullStreams = (file) => spawn(file, ["--standby"], {
      windowsHide: true, shell: false, stdio: ["pipe", "pipe", "pipe"],
    })) {}

  /** Background/service warmup is cancelled by close(); request cancellation belongs to take(). */
  prepare() { return this.ensureReady(); }

  private async ensureReady(signal?: AbortSignal, renewRecovery = true) {
    if (this.closed) throw Error("Native host closed");
    signal?.throwIfAborted();
    if (renewRecovery) this.recoveryRemaining = 1;
    const build = this.pending ??= this.compile();
    let command = await build;
    this.controller.signal.throwIfAborted();
    signal?.throwIfAborted();
    const old = this.standby;
    if (old && (old.child.exitCode !== null || old.child.signalCode !== null)) await this.children.get(old.child);
    if (!this.standby) {
      try { await access(command.file); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        signal?.throwIfAborted(); this.controller.signal.throwIfAborted();
        // Replace the promise before awaiting removal so concurrent preparation shares one rebuild.
        if (this.pending === build) this.pending = this.compile(true);
        command = await this.pending!;
      }
    }
    this.controller.signal.throwIfAborted();
    signal?.throwIfAborted();
    await (this.standby ??= this.warm(command.file)).ready;
    this.controller.signal.throwIfAborted();
    signal?.throwIfAborted();
    return command;
  }

  /** Cancellation owns preparation too, and never releases the caller before its child exits. */
  async take(replenish = true, signal?: AbortSignal): Promise<ChildProcess> {
    signal?.throwIfAborted();
    let cancelledChild: Promise<void> | undefined;
    const abort = () => {
      this.buildController?.abort(signal?.reason);
      const child = this.standby?.child;
      if (child) {
        this.expectedExits.add(child);
        cancelledChild = this.children.get(child);
        if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
      }
    };
    signal?.addEventListener("abort", abort, { once: true });
    try {
      for (let attempt = 0; attempt < 2; attempt++) {
        try { await this.ensureReady(signal); }
        catch (error) {
          if (attempt === 0 && !signal?.aborted && (error as NodeJS.ErrnoException).code === "ENOENT") continue;
          throw error;
        }
        const standby = this.standby;
        if (!standby || standby.child.exitCode !== null || standby.child.signalCode !== null) continue;
        this.standby = undefined;
        standby.child.once("close", () => {
          if (replenish && !this.closed) void this.prepare().catch(() => {});
        });
        return standby.child;
      }
      throw Error("Native host unavailable");
    } catch (error) {
      await cancelledChild;
      signal?.throwIfAborted();
      throw error;
    } finally { signal?.removeEventListener("abort", abort); }
  }

  private warm(executable: string) {
    const child = this.launch(executable);
    let warmed = false;
    const terminate = () => { if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL"); };
    process.once("exit", terminate);
    child.once("exit", () => {
      // Windows can report process exit while inherited output handles remain open.
      // Stopped hosts have no result left to drain; normal requests still read to EOF.
      if (child.killed || this.closed) this.closeExitedPipes(child);
    });
    const done = new Promise<void>((resolve) => child.once("close", () => {
      process.removeListener("exit", terminate);
      this.children.delete(child);
      const idle = this.standby?.child === child;
      if (idle) this.standby = undefined;
      resolve();
      // One automatic replacement for a ready idle crash; repeated failure waits for a new request.
      if (idle && warmed && !this.closed && !this.expectedExits.has(child) && this.recoveryRemaining > 0) {
        this.recoveryRemaining--;
        void this.ensureReady(undefined, false).catch(() => {});
      }
    }));
    this.children.set(child, done);
    // Keep a pipe error from becoming an unhandled event if the native process exits during dispatch.
    child.stdin!.on("error", terminate);
    const ready = new Promise<void>((resolve, reject) => {
      let output = "", bytes = 0, failure: unknown, settled = false;
      const fail = (error: unknown) => { failure = error; terminate(); };
      const timer = setTimeout(() => fail(Error("Native host warmup timed out")), 15_000);
      timer.unref();
      const cleanup = () => {
        clearTimeout(timer);
        child.stdout!.removeListener("data", collect);
        child.stderr!.removeListener("data", errors);
        this.controller.signal.removeEventListener("abort", abort);
      };
      const abort = () => fail(this.controller.signal.reason);
      const errors = (chunk: Buffer) => {
        bytes += chunk.length;
        if (bytes > 4096) fail(Error("Native host warmup output exceeded limit"));
      };
      const collect = (chunk: Buffer) => {
        errors(chunk); output += chunk.toString("utf8");
        if (failure || !output.includes("\n")) return;
        if (output !== "ready\r\n" && output !== "ready\n") { fail(Error("Invalid native host readiness")); return; }
        warmed = settled = true; cleanup(); resolve();
      };
      child.stdout!.on("data", collect); child.stderr!.on("data", errors);
      child.on("error", (error) => { if (!settled) fail(error); });
      child.once("close", () => {
        cleanup();
        if (!settled) reject(failure ?? Error("Native host exited before ready"));
      });
      this.controller.signal.addEventListener("abort", abort, { once: true });
      if (this.controller.signal.aborted) abort();
    });
    return { child, ready };
  }

  private compile(rebuild = false) {
    const controller = new AbortController();
    this.buildController = controller;
    return (async () => {
      if (rebuild) await this.remove();
      return this.build(controller.signal);
    })().catch((error) => { this.pending = undefined; throw error; })
      .finally(() => { if (this.buildController === controller) this.buildController = undefined; });
  }

  private async build(signal: AbortSignal) {
    try {
      signal.throwIfAborted();
      // Use the OS framework compiler by absolute path, never an executable in the workspace/PATH.
      const framework = process.arch === "ia32" ? "Framework" : "Framework64";
      const frameworkPath = join(process.env.SystemRoot || "C:\\Windows", "Microsoft.NET", framework, "v4.0.30319");
      const compiler = join(frameworkPath, "csc.exe");
      const references = ["/reference:System.Web.Extensions.dll", "/reference:Microsoft.CSharp.dll"];
      await access(compiler);
      this.directory = await mkdtemp(join(tmpdir(), "axiom-open-host-"));
      const source = join(this.directory, "Open.cs"), executable = join(this.directory, "AxiomOpen.exe");
      await writeFile(source, "\uFEFF" + windowsOpenSource + (this.mode === "explorer" ? windowsExplorerSource : ""), { encoding: "utf8", mode: 0o600 });
      signal.throwIfAborted();
      await new Promise<void>((resolve, reject) => {
        const child = spawn(compiler, ["/nologo", "/target:winexe", "/optimize+", "/utf8output", ...references, `/main:${this.mode === "explorer" ? "AxiomExplorer" : "AxiomOpen"}.Host`, `/out:${executable}`, source], {
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

  private closeExitedPipes(child: ChildProcess) {
    if (child.exitCode === null && child.signalCode === null) return;
    child.stdin?.destroy();
    child.stdout?.destroy();
    child.stderr?.destroy();
  }

  async close() {
    this.closed = true;
    this.controller.abort();
    this.buildController?.abort();
    await this.pending?.catch(() => {});
    for (const child of this.children.keys()) {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
      // Also handle a natural exit that preceded shutdown but has not reached EOF.
      this.closeExitedPipes(child);
    }
    await Promise.all(this.children.values());
    await this.remove();
  }
}
