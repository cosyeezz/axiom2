import { spawn } from "node:child_process";

// The URL is data, never shell source. In particular OAuth query strings may contain & and quotes.
export function authBrowserCommand(url: string, platform = process.platform) {
  const parsed = new URL(url);
  if (url.length > 16000 || !["https:", "http:"].includes(parsed.protocol) || parsed.username || parsed.password)
    throw Error("Invalid authorization URL");
  if (platform === "win32") return {
    file: "powershell.exe",
    args: ["-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(
      "$ErrorActionPreference = 'Stop'; Start-Process -FilePath $env:AXIOM_AUTH_URL", "utf16le",
    ).toString("base64")],
    env: { ...process.env, AXIOM_AUTH_URL: url },
  };
  return { file: platform === "darwin" ? "/usr/bin/open" : "xdg-open", args: [url], env: process.env };
}

export async function openAuthBrowser(url: string, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  const command = authBrowserCommand(url);
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command.file, command.args, {
      env: command.env, shell: false, windowsHide: true, stdio: "ignore",
      signal, timeout: 10_000,
    });
    child.once("error", reject);
    child.once("close", (code) => code === 0 ? resolve() : reject(Error("Browser launch failed")));
  });
}
