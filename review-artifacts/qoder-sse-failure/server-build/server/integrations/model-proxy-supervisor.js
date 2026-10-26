import { spawn } from "node:child_process";
// Kernel lifecycle notifications are not proof that detached descendants stopped.
// The host owns this supervisor through a Job Object or native PID namespace.
let child;
let stopping = false;
let timer;
function closed(code = null) {
    if (timer)
        clearTimeout(timer);
    if (process.connected)
        process.send?.({ type: "closed", code }, () => { if (process.connected)
            process.disconnect(); });
}
function stop() {
    if (stopping)
        return;
    stopping = true;
    if (!child) {
        closed();
        return;
    }
    child.kill("SIGTERM");
    timer = setTimeout(() => child?.kill("SIGKILL"), 1500);
}
process.on("disconnect", stop);
process.on("SIGTERM", stop);
process.on("message", (message) => {
    if (message.type === "stop") {
        stop();
        return;
    }
    if (message.type !== "start" || child || stopping)
        return;
    child = spawn(message.executable, message.args, { cwd: message.cwd, windowsHide: true, stdio: "ignore", env: message.env });
    child.once("error", () => { if (process.connected)
        process.send?.({ type: "failed" }); });
    child.once("close", closed);
});
//# sourceMappingURL=model-proxy-supervisor.js.map