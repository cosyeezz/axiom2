import { spawn } from "node:child_process";
const leave = () => {
    if (process.platform !== "win32") {
        try {
            process.kill(-process.pid, "SIGKILL");
        }
        catch { }
    }
    process.exit(1);
};
process.once("disconnect", leave);
process.once("message", (request) => {
    const child = spawn(request.file, request.args, { cwd: request.cwd, env: request.env, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    for (const [type, stream] of [["stdout", child.stdout], ["stderr", child.stderr]]) {
        stream.on("data", (data) => {
            stream.pause();
            if (!process.connected)
                return leave();
            process.send({ type, data }, error => { if (error)
                leave();
            else
                stream.resume(); });
        });
    }
    child.stdin.on("error", () => { });
    let failed = false;
    child.once("error", () => { failed = true; });
    child.once("close", code => {
        if (!process.connected)
            return leave();
        process.send(failed ? { type: "failed" } : { type: "exit", code }, () => process.disconnect());
    });
    child.stdin.end(request.input);
});
//# sourceMappingURL=tool-process-worker.js.map