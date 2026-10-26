import { createHash } from "node:crypto";
import { lstatSync, readdirSync, readFileSync, constants } from "node:fs";
import { open } from "node:fs/promises";
import { dirname, join } from "node:path";
import { openCliConfigPath, openCliSkillNames, openCliPrefix, openCliNode, validateOpenCliPackage, readOpenCliConfig } from "../integrations/opencli-runtime.js";
import { reaConfigPath, reaPackageRoot, reaSkillName, reaDirectory, readReaConfig } from "../integrations/rea-runtime.js";
import { inspectNodeRuntime } from "../integrations/managed-node.js";
import { inspectNodeLauncher } from "../integrations/node-launcher.js";
import { piDevelopmentSkillPath } from "../axiom-prompt.js";
import { rejectExecution } from "../execution-diagnostics.js";
// Private, per-failure context. Only the original thrown value escapes the public scan boundary.
class InspectionFailure {
    original;
    diagnostic;
    constructor(original, diagnostic) {
        this.original = original;
        this.diagnostic = diagnostic;
    }
}
function isInspectionFailure(error) {
    // Hostile/revoked thrown proxies may throw during instanceof; preserve that original value too.
    try {
        return error instanceof InspectionFailure;
    }
    catch {
        return false;
    }
}
function annotate(error, diagnostic) {
    return isInspectionFailure(error) ? error : new InspectionFailure(error, diagnostic);
}
function reportFailure(error, observer) {
    const failure = isInspectionFailure(error) ? error : new InspectionFailure(error, { check: 'resource_scan', cause: 'other' });
    rejectExecution(observer, failure.diagnostic);
    throw failure.original;
}
function changedFields(expected, actual, group = false) {
    if (!expected || expected === 'missing' || actual === 'missing')
        return undefined;
    const previous = expected.split(':'), next = actual.split(':'), bits = group ? [1, 2, 4, 64] : [1, 2, 4, 8, 16, 32];
    if (previous.length !== bits.length || next.length !== bits.length)
        return undefined;
    return bits.reduce((mask, bit, index) => mask | (previous[index] !== next[index] ? bit : 0), 0);
}
function changed(message, context, stage, expected, actual, group = false) {
    return annotate(Error(message), { check: 'resource_scan', ...context, stage, cause: 'metadata', changed: changedFields(expected, actual, group) });
}
const revision = (stat) => stat
    ? `${stat.dev}:${stat.ino}:${stat.mode}:${stat.size}:${stat.mtimeNs}:${stat.ctimeNs}` : "missing";
const inspect = (path) => lstatSync(path, { bigint: true, throwIfNoEntry: false });
const witnessValue = (stat, group) => group && stat?.isDirectory()
    ? `${stat.dev}:${stat.ino}:${stat.mode}:${stat.birthtimeNs}` : revision(stat);
async function readVerified(resource, signal) {
    let stage = 'resource_open';
    try {
        signal?.throwIfAborted();
        const handle = await open(resource.path, constants.O_RDONLY | constants.O_NONBLOCK);
        try {
            stage = 'resource_recheck';
            const before = await handle.stat({ bigint: true });
            if (!before.isFile() || before.size > 1024 * 1024 || revision(before) !== resource.revision)
                throw changed("Resource changed before opening", resource.context, 'resource_open', resource.revision, revision(before));
            // One extra byte detects growth without permitting an unbounded readFile allocation.
            const bytes = Buffer.alloc(Number(before.size) + 1);
            let offset = 0;
            stage = 'resource_read';
            while (offset < bytes.length) {
                signal?.throwIfAborted();
                const { bytesRead } = await handle.read(bytes, offset, bytes.length - offset, offset);
                if (!bytesRead)
                    break;
                offset += bytesRead;
            }
            signal?.throwIfAborted();
            stage = 'resource_recheck';
            // Preserve short-circuiting: a byte count change must not add a stat call.
            if (offset !== Number(before.size))
                throw annotate(Error("Resource changed during reading"), { check: 'resource_scan', ...resource.context, stage: 'resource_read', cause: 'length' });
            const after = revision(await handle.stat({ bigint: true }));
            if (after !== resource.revision)
                throw changed("Resource changed during reading", resource.context, stage, resource.revision, after);
            return bytes.subarray(0, offset);
        }
        finally {
            await handle.close();
        }
    }
    catch (error) {
        throw annotate(error, { check: 'resource_scan', ...resource.context, stage, cause: signal?.aborted ? 'aborted' : 'io' });
    }
}
let activeReads = 0;
const waitingReads = [];
function drainReads() { while (activeReads < 8 && waitingReads.length)
    waitingReads.shift()(); }
function readResource(resource, signal) {
    return new Promise((resolve, reject) => {
        const cancel = () => { const index = waitingReads.indexOf(start); if (index >= 0)
            waitingReads.splice(index, 1); signal?.removeEventListener('abort', cancel); reject(signal?.reason ?? Error('Resource read cancelled')); };
        const start = () => {
            signal?.removeEventListener('abort', cancel);
            if (signal?.aborted) {
                reject(signal.reason);
                return;
            }
            activeReads++;
            void readVerified(resource, signal).then(resolve, reject).finally(() => { activeReads--; drainReads(); });
        };
        if (signal?.aborted) {
            reject(signal.reason);
            return;
        }
        waitingReads.push(start);
        signal?.addEventListener('abort', cancel, { once: true });
        drainReads();
    });
}
// Enumerate only supported resource roots. Each invocation inspects current metadata;
// neither directory entries nor file contents survive into another validation boundary.
function* resources(cwd, agentDir, witnesses) {
    const observe = (path, context, group = false) => {
        try {
            const stat = inspect(path), previous = witnesses?.get(path);
            if (previous && previous.value !== witnessValue(stat, previous.group))
                throw changed("Resource changed during traversal", context, 'resource_traversal', previous.value, witnessValue(stat, previous.group), previous.group);
            const identityOnly = group && previous?.group !== false;
            witnesses?.set(path, { value: witnessValue(stat, identityOnly), group: identityOnly, context });
            return stat;
        }
        catch (error) {
            throw annotate(error, { check: 'resource_scan', ...context, stage: 'resource_traversal', cause: 'io' });
        }
    };
    let remaining = 5000;
    const count = (context) => { if (--remaining < 0)
        throw annotate(Error("Resource identity exceeds inspection budget"), { check: 'resource_scan', ...context, stage: 'resource_enumerate', cause: 'limit' }); };
    function* visit(path, context) {
        try {
            count(context);
            const stat = observe(path, context);
            if (!stat) {
                yield { path, kind: "missing", context };
                return;
            }
            if (stat.isSymbolicLink())
                throw annotate(Error("Linked resource requires cold binding"), { check: 'resource_scan', ...context, stage: 'resource_enumerate', cause: 'link' });
            if (stat.isDirectory()) {
                yield { path, kind: "directory", context };
                for (const name of readdirSync(path).sort()) {
                    if (!["node_modules", ".git"].includes(name))
                        yield* visit(join(path, name), context);
                }
            }
            else if (stat.isFile()) {
                if (stat.size > 1024 * 1024)
                    throw annotate(Error("Resource content exceeds inspection budget"), { check: 'resource_scan', ...context, stage: 'resource_enumerate', cause: 'limit' });
                yield { path, kind: "file", revision: revision(stat), context };
            }
            else
                throw annotate(Error("Unsupported resource type"), { check: 'resource_scan', ...context, stage: 'resource_enumerate', cause: 'kind' });
        }
        catch (error) {
            throw annotate(error, { check: 'resource_scan', ...context, stage: 'resource_enumerate', cause: 'io' });
        }
    }
    const names = ["AGENTS.md", "SYSTEM.md", "APPEND_SYSTEM.md", "extensions", "skills", "prompts"];
    const classes = ['instructions', 'system', 'append', 'extensions', 'skills', 'prompts'];
    function* group(directory, scope) {
        // Only these six children are resources. Unrelated entries (for example SDK
        // settings lock files) may change the parent timestamp without invalidating them.
        const context = { scope, resource: 'other' };
        const stat = observe(directory, context, true);
        if (stat?.isSymbolicLink())
            throw annotate(Error("Linked resource requires cold binding"), { check: 'resource_scan', ...context, stage: 'resource_enumerate', cause: 'link' });
        if (!stat) {
            // A missing parent proves all six children absent at this boundary.
            for (let index = 0; index < names.length; index++) {
                const context = { scope, resource: classes[index] };
                count(context);
                yield { path: join(directory, names[index]), kind: "missing", context };
            }
            return;
        }
        for (let index = 0; index < names.length; index++)
            yield* visit(join(directory, names[index]), { scope, resource: classes[index] });
    }
    const root = dirname(agentDir);
    yield* visit(dirname(piDevelopmentSkillPath), { scope: 'builtin', resource: 'skills' });
    yield* visit(openCliConfigPath(root), { scope: 'integration', resource: 'config' });
    const opencli = readOpenCliConfig(root);
    if (opencli && !opencli.detached) {
        if (opencli.runtime) {
            const runtime = inspectNodeRuntime(openCliPrefix(opencli), opencli.runtime);
            const { entry } = validateOpenCliPackage(opencli);
            for (const file of [...runtime.files, ...inspectNodeLauncher(openCliPrefix(opencli), openCliNode(opencli), entry)])
                yield* visit(file, { scope: 'integration', resource: 'entry' });
        }
        yield* visit(join(opencli.packageRoot, "package.json"), { scope: 'integration', resource: 'package' });
        for (const name of openCliSkillNames)
            yield* visit(join(opencli.packageRoot, "skills", name, "SKILL.md"), { scope: 'integration', resource: 'skills' });
    }
    yield* visit(reaConfigPath(root), { scope: 'integration', resource: 'config' });
    const rea = readReaConfig(root), packageRoot = reaPackageRoot(root, rea);
    if (packageRoot) {
        if (rea.installation?.runtime)
            for (const file of inspectNodeRuntime(join(reaDirectory(root), "versions", rea.installation.directory), rea.installation.runtime).files)
                yield* visit(file, { scope: 'integration', resource: 'entry' });
        yield* visit(join(packageRoot, "package.json"), { scope: 'integration', resource: 'package' });
        if (rea.mcpInstalled !== false) {
            yield* visit(join(packageRoot, "scripts", "rea.mjs"), { scope: 'integration', resource: 'entry' });
            yield* visit(join(packageRoot, "dist", "mcp", "main.js"), { scope: 'integration', resource: 'entry' });
        }
        if (rea.skillInstalled !== false)
            yield* visit(join(packageRoot, "skills", reaSkillName), { scope: 'integration', resource: 'skills' });
    }
    yield* group(agentDir, 'app');
    for (let dir = cwd;; dir = dirname(dir)) {
        const scope = dir === cwd ? 'project' : 'ancestor';
        yield* visit(join(dir, "AGENTS.md"), { scope, resource: 'instructions' });
        yield* group(join(dir, ".pi"), scope);
        if (dirname(dir) === dir)
            break;
    }
}
export function resourceIdentity(cwd, agentDir, onReject) {
    try {
        const hash = createHash("sha256");
        for (const resource of resources(cwd, agentDir)) {
            hash.update(resource.path).update(resource.kind);
            if (resource.kind === "file") {
                try {
                    hash.update(readFileSync(resource.path));
                }
                catch (error) {
                    throw annotate(error, { check: 'resource_scan', ...resource.context, stage: 'resource_read', cause: 'io' });
                }
            }
        }
        return hash.digest("hex");
    }
    catch (error) {
        return reportFailure(error, onReject);
    }
}
/** Same ordered byte digest, with eight reads per batch and eight in flight across all scans. */
export async function resourceIdentityAsync(cwd, agentDir, signal, onReject) {
    try {
        const hash = createHash("sha256"), witnesses = new Map();
        let pending = [], reads = 0;
        const flush = async () => {
            const results = await Promise.all(pending.map(item => item.read));
            for (let index = 0; index < pending.length; index++) {
                const { resource } = pending[index], result = results[index];
                hash.update(resource.path).update(resource.kind);
                if (result) {
                    if ("error" in result)
                        throw result.error;
                    hash.update(result.bytes);
                }
            }
            pending = [];
            reads = 0;
        };
        try {
            for (const resource of resources(cwd, agentDir, witnesses)) {
                signal?.throwIfAborted();
                const read = resource.kind === "file" ? readResource(resource, signal).then(bytes => ({ bytes }), error => ({ error })) : undefined;
                pending.push({ resource, read });
                if (read && ++reads === 8)
                    await flush();
            }
            await flush();
            signal?.throwIfAborted();
            // No await in this final sweep: same-process callbacks cannot change earlier
            // resources while later evidence is checked. This is not an atomic FS snapshot.
            for (const [path, expected] of witnesses) {
                try {
                    const actual = witnessValue(inspect(path), expected.group);
                    if (actual !== expected.value)
                        throw changed("Resource changed during asynchronous inspection", expected.context, 'resource_final', expected.value, actual, expected.group);
                }
                catch (error) {
                    throw annotate(error, { check: 'resource_scan', ...expected.context, stage: 'resource_final', cause: 'io' });
                }
            }
            return hash.digest("hex");
        }
        finally {
            // A traversal error must not leave unobserved I/O failures or reads running after settlement.
            if (pending.some(item => item.read))
                await Promise.all(pending.map(item => item.read));
        }
    }
    catch (error) {
        return reportFailure(error, onReject);
    }
}
//# sourceMappingURL=resource-identity.js.map