import { spawn } from "node:child_process";

// An IPC guardian also stops the core when the host crashes or loses its channel.
let child: ReturnType<typeof spawn> | undefined;
let stopping = false;
let timer: ReturnType<typeof setTimeout> | undefined;
function stop() {
  if (stopping) return;
  stopping = true;
  if (!child) { process.exit(0); return; }
  child.kill("SIGTERM");
  timer = setTimeout(() => child?.kill("SIGKILL"), 1500);
}
process.on("disconnect", stop);
process.on("SIGTERM", stop);
process.on("message", (message: any) => {
  if (message.type === "stop") { stop(); return; }
  if (message.type !== "start" || child || stopping) return;
  child = spawn(message.executable, message.args, { cwd: message.cwd, windowsHide: true, stdio: "ignore", env: message.env });
  child.once("error", () => { process.send?.({ type: "failed" }); process.exitCode = 1; if (process.connected) process.disconnect(); });
  child.once("close", code => {
    if (timer) clearTimeout(timer);
    process.send?.({ type: "closed", code }, () => { if (process.connected) process.disconnect(); });
    if (!process.connected) process.exitCode = 0;
  });
});
