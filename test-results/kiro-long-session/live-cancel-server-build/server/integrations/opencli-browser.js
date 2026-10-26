import { execFile } from "node:child_process";
import { join } from "node:path";
import { AppError } from "../../shared/protocol.js";
export const openCliExtensionUrls = {
    store: "https://chromewebstore.google.com/detail/opencli/ildkmabpimmkaediidaifkhjpohdnifk",
    download: "https://github.com/jackwener/opencli/releases",
};
// The destination and launch arguments are owned by the application, never by a web page.
export function extensionBrowserCommand(platform = process.platform, systemRoot = process.env.SystemRoot || "C:\\Windows", target = "store") {
    const url = openCliExtensionUrls[target];
    if (platform === "win32")
        return {
            file: join(systemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe"),
            args: ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", `$ErrorActionPreference = 'Stop'; Start-Process -FilePath '${url}'`],
        };
    return { file: platform === "darwin" ? "/usr/bin/open" : "xdg-open", args: [url] };
}
export function openExtensionPage(target = "store") {
    const { file, args } = extensionBrowserCommand(process.platform, undefined, target);
    return new Promise((resolve, reject) => {
        execFile(file, args, { windowsHide: true, timeout: 10_000, maxBuffer: 16_384 }, (error) => {
            if (error)
                reject(new AppError("BROWSER_OPEN_FAILED", `无法打开系统浏览器，请检查默认浏览器设置后重试，或手动访问 ${openCliExtensionUrls[target]}`));
            else
                resolve();
        });
    });
}
//# sourceMappingURL=opencli-browser.js.map