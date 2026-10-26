import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { defaultRtkSettings, rtkLevels } from "../../shared/rtk.js";
export const rtkDirectory = (root) => join(root, "integrations", "rtk");
export const rtkConfigPath = (root) => join(rtkDirectory(root), "config.json");
export const rtkVersionPattern = /^\d{1,5}\.\d{1,5}\.\d{1,5}$/;
export const rtkDirectoryPattern = /^v[\d.]+-[a-f0-9-]{36}$/;
export function atomicRtkJson(path, value) {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    const temp = `${path}.${randomUUID()}.tmp`;
    try {
        writeFileSync(temp, JSON.stringify(value, null, 2) + "\n", { flag: "wx", mode: 0o600 });
        renameSync(temp, path);
    }
    finally {
        rmSync(temp, { force: true });
    }
}
export function validRtkSettings(value) {
    const p = value;
    return !!p && typeof p.enabled === "boolean" && typeof p.subagents === "boolean" && rtkLevels.includes(p.level);
}
export function readRtkConfig(root) {
    let value;
    try {
        value = JSON.parse(readFileSync(rtkConfigPath(root), "utf8"));
    }
    catch (error) {
        if (error.code === "ENOENT")
            return { format: 1, revision: "", ...defaultRtkSettings };
        throw Error("RTK 配置无法读取，请检查 integrations/rtk/config.json；未覆盖原配置。");
    }
    if (value?.format !== 1 || typeof value.revision !== "string" || !validRtkSettings(value) || (value.installation &&
        (!rtkVersionPattern.test(value.installation.version) || !rtkDirectoryPattern.test(value.installation.directory))) ||
        (value.removalPending !== undefined && (!Array.isArray(value.removalPending) || value.removalPending.some(name => typeof name !== "string" || !rtkDirectoryPattern.test(name)))))
        throw Error("RTK 配置无效；未覆盖原配置。");
    return value;
}
export function rtkExecutable(root, config) {
    return config.installation ? join(rtkDirectory(root), "versions", config.installation.directory, process.platform === "win32" ? "rtk.exe" : "rtk") : undefined;
}
export function newerRtk(a, b) {
    if (!rtkVersionPattern.test(a) || !rtkVersionPattern.test(b))
        return false;
    const aa = a.split(".").map(Number), bb = b.split(".").map(Number);
    for (let i = 0; i < 3; i++)
        if (aa[i] !== bb[i])
            return aa[i] > bb[i];
    return false;
}
//# sourceMappingURL=rtk-config.js.map