import { fork } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { lstatSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { MaintenanceError } from "../shared/maintenance.js";
const unsupported = () => new MaintenanceError("operation", "此 Linux 环境无法建立可靠的进程隔离，尚未执行程序。请检查应用原生组件、内核命名空间与权限。");
const uncertain = () => new MaintenanceError("stop-unconfirmed", "原生监督器未确认整个进程树退出，记录和残留文件已保留。");
export const monotonicMilliseconds = () => Number(process.hrtime.bigint() / 1000000n);
/** The native PID1 owns descendants, including setsid/double-fork children.
 * A CLEANED receipt after waitpid(PID1), never a launcher exit, proves cleanup. */
export function forkLinuxOwned(entry, options, deadline, timeoutError = () => new MaintenanceError("total-timeout", "程序已达到执行期限，整个进程树已停止。"), beforeStart) {
    if (process.platform !== "linux" || !["x64", "arm64"].includes(process.arch))
        throw unsupported();
    const helper = fileURLToPath(new URL(`../../../bin/native/linux-${process.arch}/axiom-owner`, import.meta.url));
    try {
        const stat = lstatSync(helper), manifest = JSON.parse(readFileSync(join(dirname(helper), "manifest.json"), "utf8"));
        if (!stat.isFile() || stat.isSymbolicLink() || stat.mode & 0o6000 || manifest.protocol !== 1 || manifest.arch !== process.arch || manifest.sha256 !== createHash("sha256").update(readFileSync(helper)).digest("hex"))
            throw unsupported();
    }
    catch {
        throw unsupported();
    }
    const nonce = randomUUID();
    const child = fork(entry, [], { ...options, execPath: helper, execArgv: [process.execPath, ...(options.execArgv ?? [])],
        env: { ...(options.env ?? process.env), AXIOM_OWNER_PARENT: String(process.pid), AXIOM_OWNER_NONCE: nonce, AXIOM_OWNER_DEADLINE: String(Math.floor(deadline)) },
        detached: false, stdio: ["ignore", "ignore", "ignore", "ipc", "pipe"],
    });
    return superviseLinuxOwnedChild(child, nonce, deadline, timeoutError, beforeStart);
}
/** Isolated protocol state machine; callers still need a verified native helper. */
export function superviseLinuxOwnedChild(child, nonce, deadline, timeoutError, beforeStart) {
    const control = child.stdio[4];
    let received = "", admitted = false, cleaned = false, ended = false, revoked = false, closing = false, sawReady = false, nativeError;
    let arming = Promise.resolve(), transportError;
    let readyResolve, readyReject;
    const ready = new Promise((resolve, reject) => { readyResolve = resolve; readyReject = reject; });
    let cleanResolve, cleanReject;
    const stopped = new Promise((resolve, reject) => { cleanResolve = resolve; cleanReject = reject; });
    void ready.catch(() => { });
    void stopped.catch(() => { });
    let lastDeadline = Math.floor(deadline);
    const transportFailed = () => {
        // Once the nonce-bound receipt has proved waitpid(PID1), a late write error
        // cannot make that tree alive again. Protocol errors remain fail-closed.
        if (cleaned)
            return;
        revoked = true;
        transportError ??= uncertain();
        readyReject(nativeError ?? transportError);
    };
    const send = (line, acknowledgement = false) => {
        // An ACK is allowed after the deadline: it acknowledges proof, not work.
        if ((acknowledgement || monotonicMilliseconds() < lastDeadline) && !ended && !control.destroyed) {
            control.write(line + "\n", error => { if (error)
                transportFailed(); });
            return true;
        }
        return false;
    };
    control.on("error", transportFailed);
    control.setEncoding("utf8");
    control.on("data", (chunk) => {
        received += chunk;
        if (received.length > 4096) {
            revoked = true;
            nativeError = uncertain();
            readyReject(nativeError);
            send("STOP");
            return;
        }
        let newline;
        while ((newline = received.indexOf("\n")) >= 0) {
            const line = received.slice(0, newline);
            received = received.slice(newline + 1);
            const match = /^(READY|CLEANED|ERROR) ([a-f0-9-]{36}) (\d+) (\d+)$/.exec(line);
            if (!match || match[2] !== nonce) {
                revoked = true;
                nativeError = uncertain();
                readyReject(nativeError);
                send("STOP");
                continue;
            }
            if (match[1] === "READY") {
                const initPid = Number(match[3]), startTime = match[4];
                if (sawReady || !Number.isSafeInteger(initPid) || initPid <= 1 || !/^[1-9]\d*$/.test(startTime)) {
                    revoked = true;
                    nativeError ??= unsupported();
                    readyReject(nativeError);
                    send("STOP");
                    continue;
                }
                sawReady = true;
                arming = Promise.resolve().then(async () => {
                    if (revoked || cleaned || ended)
                        throw nativeError ?? transportError ?? unsupported();
                    await beforeStart?.({ platform: "linux", initPid, startTime });
                    if (revoked || cleaned || ended)
                        throw nativeError ?? transportError ?? unsupported();
                    if (monotonicMilliseconds() >= lastDeadline)
                        throw timeoutError();
                    if (!send("GO"))
                        throw nativeError ?? transportError ?? unsupported();
                    admitted = true;
                    readyResolve();
                }).catch(error => {
                    revoked = true;
                    if (error !== transportError)
                        nativeError ??= error instanceof Error ? error : unsupported();
                    readyReject(nativeError ?? transportError ?? unsupported());
                    send("STOP");
                });
            }
            else if (match[1] === "ERROR") {
                revoked = true;
                nativeError ??= unsupported();
                readyReject(nativeError);
            }
            else if (match[1] === "CLEANED") {
                revoked = true;
                cleaned = true;
                const reason = Number(match[3]);
                if (reason === 2)
                    nativeError ??= timeoutError();
                else if (reason > 2)
                    nativeError ??= new MaintenanceError("operation", "原生监督器中断了程序，整个进程树已停止。");
                if (!admitted) {
                    nativeError ??= unsupported();
                    readyReject(nativeError);
                }
                send(`ACK ${nonce}`, true);
                cleanResolve();
            }
        }
    });
    child.once("error", () => { revoked = true; nativeError ??= unsupported(); readyReject(nativeError); });
    child.once("close", () => {
        ended = true;
        revoked = true;
        if (!admitted) {
            readyReject(nativeError ?? transportError ?? unsupported());
            cleanResolve();
        } // No business request was admitted.
        else if (!cleaned) {
            nativeError = uncertain();
            cleanReject(nativeError);
        }
    });
    let stopping;
    return {
        child, ready,
        // Valid proof supersedes transport uncertainty regardless of callback order,
        // but protocol/domain errors are separate and can never be cleared by it.
        failure: () => nativeError ?? (cleaned ? undefined : transportError),
        setDeadline(value) {
            const next = Math.floor(value), now = monotonicMilliseconds();
            if (!Number.isSafeInteger(next) || next <= now || next === lastDeadline || closing || cleaned || ended || now >= lastDeadline)
                return;
            lastDeadline = next;
            send(`DEADLINE ${next}`);
        },
        close() {
            closing = true;
            revoked = true;
            if (!admitted)
                readyReject(nativeError ?? transportError ?? unsupported());
            return stopping ??= (async () => {
                if (!cleaned)
                    send("STOP");
                let timer;
                try {
                    await Promise.race([Promise.all([stopped, arming]), new Promise((_, reject) => { timer = setTimeout(() => reject(uncertain()), 7000); })]);
                }
                finally {
                    clearTimeout(timer);
                }
            })();
        },
    };
}
//# sourceMappingURL=owned-process-linux.js.map