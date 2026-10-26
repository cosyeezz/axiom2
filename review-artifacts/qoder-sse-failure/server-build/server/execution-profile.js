import { modelProxyRevision, providerProxyUrl, parseProviderProxy } from "./integrations/model-proxy-env.js";
import { capabilityFileDigest } from "./capability-resources.js";
import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { resourceIdentity, resourceIdentityAsync } from "./agents/resource-identity.js";
import { rejectExecution } from "./execution-diagnostics.js";
export const digest = (value) => createHash("sha256").update(value).digest("hex");
function stable(value) {
    if (Array.isArray(value))
        return `[${value.map(stable).join(",")}]`;
    if (value && typeof value === "object")
        return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stable(value[key])}`).join(",")}}`;
    return JSON.stringify(value) ?? "null";
}
export function fileRevision(file) {
    try {
        const s = statSync(file);
        return `${s.dev}:${s.ino}:${s.size}:${s.mtimeMs}:${s.ctimeMs}`;
    }
    catch (error) {
        if (error.code === "ENOENT")
            return "missing";
        throw error;
    }
}
function contentRevision(file) {
    try {
        return digest(readFileSync(file));
    }
    catch (error) {
        if (error.code === "ENOENT")
            return "missing";
        throw error;
    }
}
const canonicalPath = (path) => realpathSync.native(resolve(path));
function jsonRevision(file) {
    try {
        return digest(stable(JSON.parse(readFileSync(file, 'utf8'))));
    }
    catch (error) {
        if (error.code === 'ENOENT')
            return 'missing';
        throw error;
    }
}
const sdkVersions = Object.fromEntries(['pi-coding-agent', 'pi-agent-core', 'pi-ai'].map(name => {
    const file = new URL('../package.json', import.meta.resolve(`@earendil-works/${name}`));
    return [name, JSON.parse(readFileSync(file, 'utf8')).version];
}));
/** Immutable model files belong to environments, not to the Run that first borrowed them. */
export class ExecutionProfiles {
    root;
    snapshots = new Map();
    directory;
    constructor(root) {
        this.root = root;
        this.directory = join(root, "execution-models");
        mkdirSync(this.directory, { recursive: true, mode: 0o700 });
        // Store's service lock protects this data root. Never clean the shared pi directory.
        for (const name of readdirSync(this.directory))
            if (/^[a-f0-9]{64}(?:\.[a-f0-9-]{36})?\.json$/.test(name))
                rmSync(join(this.directory, name), { force: true });
    }
    prepare(input) { return this.prepareWithResources(input); }
    async prepareAsync(input, signal) {
        if (input.entry !== 'agent')
            return this.prepare(input);
        let captured;
        try {
            captured = { version: await resourceIdentityAsync(input.cwd, join(this.root, 'pi'), signal), verifiable: true };
        }
        catch {
            captured = { version: randomUUID(), verifiable: false };
        }
        return this.prepareWithResources(input, captured);
    }
    prepareWithResources(input, captured) {
        const source = import.meta.url.endsWith(".ts");
        const workerPath = fileURLToPath(new URL(`./${input.entry === "agent" ? "agent" : input.entry === "memory" ? "memory" : "compression"}-worker.${source ? "ts" : "js"}`, import.meta.url));
        const modelDigest = digest(stable(JSON.parse(input.modelsRaw)));
        const modelFiles = ["models.json", "auth.json", "models-store.json"].map(name => join(input.modelDir, name));
        const modelRevisions = modelFiles.map(jsonRevision);
        const configRevision = digest(stable(modelRevisions));
        const settingsFiles = [join(this.root, "pi", "settings.json"), join(input.cwd, ".pi", "settings.json")];
        const settings = input.entry === "agent" ? settingsFiles.map(jsonRevision) : [];
        const localResources = () => {
            if (input.entry !== 'agent')
                return;
            // Arbitrary external package/import graphs are not proven by a local resource scan.
            for (const file of settingsFiles) {
                let settings;
                try {
                    settings = JSON.parse(readFileSync(file, 'utf8'));
                }
                catch (error) {
                    if (error.code === 'ENOENT')
                        continue;
                    throw error;
                }
                if (['packages', 'extensions', 'skills', 'prompts'].some(key => Array.isArray(settings[key]) && settings[key].length))
                    throw Error('External configured resources require cold binding');
            }
        };
        const resources = (onReject) => { localResources(); return input.entry === 'agent' ? resourceIdentity(input.cwd, join(this.root, 'pi'), onReject) : 'fixed-resources-v1'; };
        let resourceVersion, verifiable = true;
        try {
            localResources();
            resourceVersion = captured?.version ?? resources();
            verifiable = captured?.verifiable ?? true;
        }
        catch {
            resourceVersion = randomUUID();
            verifiable = false;
        }
        const provider = input.selection?.provider;
        // Resolve before admission so a stopped built-in entry fails without sending a model request.
        if (provider)
            providerProxyUrl(this.root, parseProviderProxy(JSON.parse(input.modelsRaw).providers?.[provider]?.axiomProxy));
        const proxyRevision = digest(modelProxyRevision(this.root));
        const env = { ...process.env, AXIOM_PI_DIR: input.modelDir, AXIOM_MODEL_PROVIDER: provider ?? "" };
        const execArgv = source ? ["--import", import.meta.resolve("tsx")] : [];
        const reuse = input.entry === "agent" ? (verifiable ? "same-session" : "single-use") : input.entry === "memory" && input.mode === "D" ? "cross-binding" : "single-use";
        const profileHash = digest(stable({ schema: 1, adapter: 1, build: contentRevision(workerPath), sdk: sdkVersions, node: process.version,
            entry: input.entry, reuse, cwd: canonicalPath(input.cwd), agentDir: resolve(this.root, "pi"),
            modelDir: canonicalPath(input.modelDir), env, execArgv, modelDigest, configRevision, settings, resourceVersion,
            selection: input.entry === "agent" ? input.selection : null, provider, proxyRevision, capabilities: input.capabilities ?? null }));
        let snapshot = this.snapshots.get(modelDigest);
        if (snapshot) {
            try {
                snapshot.valid = snapshot.valid && jsonRevision(snapshot.path) === modelDigest;
            }
            catch {
                snapshot.valid = false;
            }
            if (!snapshot.valid)
                snapshot = undefined;
        }
        if (!snapshot) {
            snapshot = { path: join(this.directory, `${modelDigest}.${randomUUID()}.json`), refs: 0, valid: true };
            writeFileSync(snapshot.path, input.modelsRaw, { flag: "wx", mode: 0o600 });
            this.snapshots.set(modelDigest, snapshot);
        }
        snapshot.refs++;
        const owned = snapshot;
        const modelChecks = ['models', 'auth', 'models_store'];
        const current = (checkResources = true, onReject) => {
            let check = 'model_config', resource;
            let scanRejection = { check: 'resource_scan', cause: 'other' };
            try {
                // Keep the original eager model reads and subsequent short-circuit order.
                const revisions = modelFiles.map((file, index) => { check = modelChecks[index]; return jsonRevision(file); }), currentModels = revisions[0];
                check = 'capability_file';
                if (!(input.capabilities?.files.every(file => {
                    const name = basename(file.path);
                    resource = name === 'settings.json' ? 'settings' : name === 'mcp.json' ? 'mcp' : name === 'SKILL.md' ? 'skills' : 'other';
                    return capabilityFileDigest(file.path) === file.digest;
                }) ?? true))
                    return rejectExecution(onReject, { check, resource });
                check = 'models';
                if ((currentModels === 'missing' ? digest(stable({ providers: {} })) : currentModels) !== modelDigest)
                    return rejectExecution(onReject, { check });
                check = 'model_config';
                if (configRevision !== digest(stable(revisions)))
                    return rejectExecution(onReject, { check: modelChecks[revisions.findIndex((value, index) => value !== modelRevisions[index])] ?? check });
                check = 'proxy';
                if (proxyRevision !== digest(modelProxyRevision(this.root)))
                    return rejectExecution(onReject, { check });
                if (input.entry === 'agent') {
                    check = 'settings';
                    if (stable(settingsFiles.map(jsonRevision)) !== stable(settings))
                        return rejectExecution(onReject, { check });
                    if (checkResources && verifiable) {
                        check = 'resource_scan';
                        if (resources(rejection => { scanRejection = rejection; }) !== resourceVersion)
                            return rejectExecution(onReject, { check: 'resource_digest' });
                    }
                }
                return true;
            }
            catch {
                return rejectExecution(onReject, check === 'resource_scan' ? scanRejection : { check });
            }
        };
        return Object.freeze({ profileHash, entry: input.entry, reuse, cwd: input.cwd, root: this.root, modelDir: input.modelDir,
            modelsFile: snapshot.path, workerPath, execArgv, env, environmentWarm: input.entry === "memory" && input.mode === "D",
            provider, configRevision, prewarmAllowed: verifiable,
            current,
            currentAsync: async (signal, onReject) => {
                if (signal?.aborted)
                    return rejectExecution(onReject, { check: 'aborted', stage: 'pre_io' });
                if (!current(false, rejection => { rejectExecution(onReject, { ...rejection, stage: 'pre_io' }); }))
                    return false;
                if (input.entry !== 'agent' || !verifiable)
                    return true;
                let scanRejection = { check: 'resource_scan', cause: 'other' };
                try {
                    localResources();
                    const version = await resourceIdentityAsync(input.cwd, join(this.root, 'pi'), signal, rejection => { scanRejection = rejection; });
                    if (signal?.aborted)
                        return rejectExecution(onReject, { check: 'aborted', stage: 'post_io' });
                    if (version !== resourceVersion)
                        return rejectExecution(onReject, { check: 'resource_digest', stage: 'post_io' });
                    return current(false, rejection => { rejectExecution(onReject, { ...rejection, stage: 'post_io' }); });
                }
                catch {
                    return rejectExecution(onReject, signal?.aborted ? { check: 'aborted', stage: 'post_io' } : scanRejection);
                }
            },
            snapshotValid: (onReject) => {
                try {
                    return owned.valid && jsonRevision(owned.path) === modelDigest || rejectExecution(onReject, { check: 'snapshot' });
                }
                catch {
                    return rejectExecution(onReject, { check: 'snapshot' });
                }
            },
            retain: () => { if (owned.refs <= 0)
                throw Error("Execution snapshot already released"); owned.refs++; },
            release: () => {
                if (owned.refs <= 0 || --owned.refs !== 0)
                    return;
                if (this.snapshots.get(modelDigest) === owned)
                    this.snapshots.delete(modelDigest);
                // The reference is released even if an OS file lock delays deletion.
                // The next service startup retries these unreferenced, owned snapshots.
                try {
                    rmSync(owned.path, { force: true });
                }
                catch { /* Do not interrupt process close listeners. */ }
            }, });
    }
    get size() { return this.snapshots.size; }
}
//# sourceMappingURL=execution-profile.js.map