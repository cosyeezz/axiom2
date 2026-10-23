import { modelProxyRevision, providerProxyUrl, parseProviderProxy } from "./integrations/model-proxy-env.js";
import { capabilityFileDigest, type CapabilityRuntime } from "./capability-resources.js";
import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Selection } from "../shared/agent.js";
import { resourceIdentity, resourceIdentityAsync } from "./agents/resource-identity.js";

export type WorkerEntry = "agent" | "memory" | "compression";
export type ReuseMode = "single-use" | "same-session" | "cross-binding";
export type ExecutionMode = "managed" | "C" | "D";
export const digest = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stable((value as Record<string, unknown>)[key])}`).join(",")}}`;
  return JSON.stringify(value) ?? "null";
}
export function fileRevision(file: string) {
  try { const s = statSync(file); return `${s.dev}:${s.ino}:${s.size}:${s.mtimeMs}:${s.ctimeMs}`; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return "missing"; throw error; }
}
function contentRevision(file: string) {
  try { return digest(readFileSync(file)); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return "missing"; throw error; }
}
const canonicalPath = (path: string) => realpathSync.native(resolve(path));
function jsonRevision(file: string) {
  try { return digest(stable(JSON.parse(readFileSync(file, 'utf8')))); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 'missing'; throw error; }
}
const sdkVersions = Object.fromEntries(['pi-coding-agent', 'pi-agent-core', 'pi-ai'].map(name => {
  const file = new URL('../package.json', import.meta.resolve(`@earendil-works/${name}`));
  return [name, JSON.parse(readFileSync(file, 'utf8')).version];
}));
export interface EnvironmentInput {
  entry: WorkerEntry; cwd: string; modelDir: string; modelsRaw: string; selection?: Selection;
  capabilities?: CapabilityRuntime; mode: ExecutionMode;
}
export interface PreparedEnvironment {
  readonly profileHash: string;
  readonly entry: WorkerEntry;
  readonly reuse: ReuseMode;
  readonly cwd: string;
  readonly root: string;
  readonly modelDir: string;
  readonly modelsFile: string;
  readonly workerPath: string;
  readonly execArgv: string[];
  readonly env: NodeJS.ProcessEnv;
  readonly environmentWarm: boolean;
  readonly prewarmAllowed?: boolean;
  readonly provider?: string;
  readonly configRevision: string;
  current(checkResources?: boolean): boolean;
  currentAsync?(signal?: AbortSignal): Promise<boolean>;
  snapshotValid(): boolean;
  retain(): void;
  release(): void;
}
/** Immutable model files belong to environments, not to the Run that first borrowed them. */
export class ExecutionProfiles {
  private snapshots = new Map<string, { path: string; refs: number; valid: boolean }>();
  private readonly directory: string;
  constructor(readonly root: string) {
    this.directory = join(root, "execution-models");
    mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    // Store's service lock protects this data root. Never clean the shared pi directory.
    for (const name of readdirSync(this.directory)) if (/^[a-f0-9]{64}(?:\.[a-f0-9-]{36})?\.json$/.test(name)) rmSync(join(this.directory, name), { force: true });
  }
  prepare(input: EnvironmentInput): PreparedEnvironment { return this.prepareWithResources(input); }
  async prepareAsync(input: EnvironmentInput, signal?: AbortSignal): Promise<PreparedEnvironment> {
    if (input.entry !== 'agent') return this.prepare(input);
    let captured: { version: string; verifiable: boolean };
    try { captured = { version: await resourceIdentityAsync(input.cwd, join(this.root, 'pi'), signal), verifiable: true }; }
    catch { captured = { version: randomUUID(), verifiable: false }; }
    return this.prepareWithResources(input, captured);
  }
  private prepareWithResources(input: EnvironmentInput, captured?: { version: string; verifiable: boolean }): PreparedEnvironment {
    const source = import.meta.url.endsWith(".ts");
    const workerPath = fileURLToPath(new URL(`./${input.entry === "agent" ? "agent" : input.entry === "memory" ? "memory" : "compression"}-worker.${source ? "ts" : "js"}`, import.meta.url));
    const modelDigest = digest(stable(JSON.parse(input.modelsRaw)));
    const modelFiles = ["models.json", "auth.json", "models-store.json"].map(name => join(input.modelDir, name));
    const configRevision = digest(stable(modelFiles.map(jsonRevision)));
    const settingsFiles = [join(this.root, "pi", "settings.json"), join(input.cwd, ".pi", "settings.json")];
    const settings = input.entry === "agent" ? settingsFiles.map(jsonRevision) : [];
    const localResources = () => {
      if (input.entry !== 'agent') return;
      // Arbitrary external package/import graphs are not proven by a local resource scan.
      for (const file of settingsFiles) {
        let settings: Record<string, unknown>;
        try { settings = JSON.parse(readFileSync(file, 'utf8')); }
        catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue; throw error; }
        if (['packages', 'extensions', 'skills', 'prompts'].some(key => Array.isArray(settings[key]) && settings[key].length))
          throw Error('External configured resources require cold binding');
      }
    };
    const resources = () => { localResources(); return input.entry === 'agent' ? resourceIdentity(input.cwd, join(this.root, 'pi')) : 'fixed-resources-v1'; };
    let resourceVersion: string, verifiable = true;
    try { localResources(); resourceVersion = captured?.version ?? resources(); verifiable = captured?.verifiable ?? true; }
    catch { resourceVersion = randomUUID(); verifiable = false; }
    const provider = input.selection?.provider;
    // Resolve before admission so a stopped built-in entry fails without sending a model request.
    if (provider) providerProxyUrl(this.root, parseProviderProxy(JSON.parse(input.modelsRaw).providers?.[provider]?.axiomProxy));
    const proxyRevision = digest(modelProxyRevision(this.root));
    const env = { ...process.env, AXIOM_PI_DIR: input.modelDir, AXIOM_MODEL_PROVIDER: provider ?? "" };
    const execArgv = source ? ["--import", import.meta.resolve("tsx")] : [];
    const reuse: ReuseMode = input.entry === "agent" ? (verifiable ? "same-session" : "single-use") : input.entry === "memory" && input.mode === "D" ? "cross-binding" : "single-use";
    const profileHash = digest(stable({ schema: 1, adapter: 1, build: contentRevision(workerPath), sdk: sdkVersions, node: process.version,
      entry: input.entry, reuse, cwd: canonicalPath(input.cwd), agentDir: resolve(this.root, "pi"),
      modelDir: canonicalPath(input.modelDir), env, execArgv, modelDigest, configRevision, settings, resourceVersion,
      selection: input.entry === "agent" ? input.selection : null, provider, proxyRevision, capabilities: input.capabilities ?? null }));
    let snapshot = this.snapshots.get(modelDigest);
    if (snapshot) {
      try { snapshot.valid = snapshot.valid && jsonRevision(snapshot.path) === modelDigest; }
      catch { snapshot.valid = false; }
      if (!snapshot.valid) snapshot = undefined;
    }
    if (!snapshot) {
      snapshot = { path: join(this.directory, `${modelDigest}.${randomUUID()}.json`), refs: 0, valid: true };
      writeFileSync(snapshot.path, input.modelsRaw, { flag: "wx", mode: 0o600 });
      this.snapshots.set(modelDigest, snapshot);
    }
    snapshot.refs++;
    const owned = snapshot;
    const current = (checkResources = true) => {
      try { const revisions = modelFiles.map(jsonRevision), currentModels = revisions[0];
        return (input.capabilities?.files.every(file => capabilityFileDigest(file.path) === file.digest) ?? true) &&
        (currentModels === 'missing' ? digest(stable({providers:{}})) : currentModels) === modelDigest &&
        configRevision === digest(stable(revisions)) && proxyRevision === digest(modelProxyRevision(this.root)) &&
        (input.entry !== "agent" || stable(settingsFiles.map(jsonRevision)) === stable(settings) && (!checkResources || !verifiable || resources() === resourceVersion)); }
      catch { return false; }
    };
    return Object.freeze({ profileHash, entry: input.entry, reuse, cwd: input.cwd, root: this.root, modelDir: input.modelDir,
      modelsFile: snapshot.path, workerPath, execArgv, env, environmentWarm: input.entry === "memory" && input.mode === "D",
      provider, configRevision, prewarmAllowed: verifiable,
      current,
      currentAsync: async (signal?: AbortSignal) => {
        if (signal?.aborted || !current(false)) return false;
        if (input.entry !== 'agent' || !verifiable) return true;
        try { localResources(); const version = await resourceIdentityAsync(input.cwd, join(this.root, 'pi'), signal);
          return !signal?.aborted && version === resourceVersion && current(false); }
        catch { return false; }
      },
      snapshotValid: () => { try { return owned.valid && jsonRevision(owned.path) === modelDigest; } catch { return false; } },
      retain: () => { if (owned.refs <= 0) throw Error("Execution snapshot already released"); owned.refs++; },
      release: () => {
        if (owned.refs <= 0 || --owned.refs !== 0) return;
        if (this.snapshots.get(modelDigest) === owned) this.snapshots.delete(modelDigest);
        // The reference is released even if an OS file lock delays deletion.
        // The next service startup retries these unreferenced, owned snapshots.
        try { rmSync(owned.path, { force: true }); } catch { /* Do not interrupt process close listeners. */ }
      },
    });
  }
  get size() { return this.snapshots.size; }
}
