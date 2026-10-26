import { randomUUID, createHash } from "node:crypto";
import { closeSync, constants, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { lockResourcePaths } from "./resource-file-lock.js";
import { MaintenanceError } from "../shared/maintenance.js";
const uuid = /^[a-f0-9-]{36}$/;
const uncertain = () => new MaintenanceError("stop-unconfirmed", "资源安装的进程或父提交记录无法核实，已保留目录与记录。");
function directoryIdentity(path) {
    const stat = lstatSync(path, { bigint: true });
    if (!stat.isDirectory() || stat.isSymbolicLink())
        throw uncertain();
    return { dev: String(stat.dev), ino: String(stat.ino) };
}
function syncDirectory(path) {
    if (process.platform === "win32")
        return;
    const fd = openSync(path, constants.O_RDONLY | constants.O_DIRECTORY);
    try {
        fsyncSync(fd);
    }
    finally {
        closeSync(fd);
    }
}
function durable(path, value, initial = false) {
    const temp = initial ? path : `${path}.${randomUUID()}.tmp`;
    let fd;
    try {
        fd = openSync(temp, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0), 0o600);
        writeFileSync(fd, JSON.stringify(value) + "\n");
        fsyncSync(fd);
        closeSync(fd);
        fd = undefined;
        if (!initial)
            renameSync(temp, path);
        syncDirectory(dirname(path));
    }
    finally {
        if (fd !== undefined)
            closeSync(fd);
        if (!initial)
            rmSync(temp, { force: true });
    }
}
function readRecord(path, root) {
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size > 65536)
        throw uncertain();
    const record = JSON.parse(readFileSync(path, "utf8"));
    const localDirectory = (path) => typeof path === "string" && dirname(path) === root && uuid.test(basename(path));
    if (!record || !uuid.test(record.jobId) || basename(path) !== `.npm-operation-${record.jobId}.json` || !localDirectory(record.directory) || typeof record.scopeId !== "string" || !["skill", "mcp"].includes(record.kind) || typeof record.packageName !== "string")
        throw uncertain();
    if (record.format !== undefined && (record.format !== 2 || !uuid.test(record.generation ?? "") || typeof record.domain !== "string" || !["running", "ready"].includes(record.phase ?? "") || !record.identity || typeof record.identity.dev !== "string" || typeof record.identity.ino !== "string" || record.previous && (!localDirectory(record.previous.directory) || typeof record.previous.identity?.dev !== "string" || typeof record.previous.identity?.ino !== "string")))
        throw uncertain();
    if (record.phase === "ready" && !["not-started", "tree-cleaned"].includes(record.proof ?? ""))
        throw uncertain();
    return record;
}
export function listNpmPending(root) {
    if (!existsSync(root))
        return [];
    try {
        return readdirSync(root).filter(name => /^\.npm-operation-[a-f0-9-]+\.json$/.test(name)).map(name => readRecord(join(root, name), root));
    }
    catch {
        throw uncertain();
    }
}
function leasePath(domain, record) {
    const logical = record.kind === "mcp" ? record.name?.replace(/-/g, "_") : record.packageName;
    if (!logical)
        throw uncertain();
    const key = createHash("sha256").update(JSON.stringify([basename(domain), record.kind, logical])).digest("hex");
    // Stable per configuration domain and resource, not per attempt or version.
    return join(dirname(domain), `.axiom-npm-${key}`);
}
function handle(root, initial, release) {
    let record = initial, closed = false, removed = false;
    const path = join(root, `.npm-operation-${record.jobId}.json`);
    const assertSame = () => {
        if (closed || removed || JSON.stringify(readRecord(path, root)) !== JSON.stringify(record))
            throw uncertain();
    };
    const assertDirectory = (directory = record.directory, required = false) => {
        assertSame();
        const expected = directory === record.directory ? record.identity : directory === record.previous?.directory ? record.previous.identity : undefined;
        if (!expected || !existsSync(directory) && required || existsSync(directory) && JSON.stringify(directoryIdentity(directory)) !== JSON.stringify(expected))
            throw uncertain();
    };
    return {
        get record() { return record; },
        get ready() { return !closed && !removed && record.phase === "ready" && !record.unconfirmed; },
        assertDirectory,
        readyWith(proof) {
            assertSame();
            if (record.phase !== "running" || record.unconfirmed || !["not-started", "tree-cleaned"].includes(proof))
                throw uncertain();
            if (JSON.stringify(directoryIdentity(record.directory)) !== JSON.stringify(record.identity))
                throw uncertain();
            const next = { ...record, phase: "ready", proof };
            durable(path, next);
            record = next;
        },
        retainUnknown() {
            assertSame();
            const next = { ...record, unconfirmed: true };
            durable(path, next);
            record = next;
        },
        finish() {
            assertDirectory();
            if (record.previous)
                assertDirectory(record.previous.directory);
            if (record.phase !== "ready" || record.unconfirmed)
                throw uncertain();
            rmSync(path);
            syncDirectory(root);
            removed = true;
        },
        close() { if (!closed) {
            closed = true;
            release();
        } },
    };
}
export function beginNpmOperation(root, input, domain, previousDirectory) {
    const release = lockResourcePaths([leasePath(domain, input)]);
    try {
        mkdirSync(root, { recursive: true, mode: 0o700 });
        mkdirSync(input.directory, { mode: 0o700 });
        const record = { ...input, format: 2, generation: randomUUID(), domain: resolve(domain), phase: "running", identity: directoryIdentity(input.directory),
            ...(previousDirectory && existsSync(previousDirectory) ? { previous: { directory: previousDirectory, identity: directoryIdentity(previousDirectory) } } : {}) };
        durable(join(root, `.npm-operation-${record.jobId}.json`), record, true);
        return handle(root, record, release);
    }
    catch (error) {
        release();
        throw error;
    }
}
export function claimNpmOperation(root, record, domain) {
    // Scope authorization and the current domain are supplied by Resources. Do not
    // acquire arbitrary paths from a journal whose workspace was removed.
    if (record.format !== 2 || record.domain !== resolve(domain))
        throw uncertain();
    const release = lockResourcePaths([leasePath(domain, record)]);
    try {
        if (JSON.stringify(readRecord(join(root, `.npm-operation-${record.jobId}.json`), root)) !== JSON.stringify(record))
            throw uncertain();
        return handle(root, record, release);
    }
    catch (error) {
        release();
        throw error;
    }
}
//# sourceMappingURL=resource-npm-operation.js.map