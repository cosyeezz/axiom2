import { MaintenanceError } from "../../shared/maintenance.js";
import { accessSync, constants, existsSync, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, dirname, isAbsolute, join, win32, posix } from "node:path";
import { reaEngineIds } from "../../shared/rea-engines.js";
import { inspectReaProgram, reaEngineRevision, reaDirectory, reaNode, reaProcessEnvironment } from "./rea-runtime.js";
import { runEngine } from "./rea-engine-process.js";
import { maintenanceProcessSupported } from "../maintenance-process.js";
import { engineContractVersion, engineContractSupported, engineVersionPolicy, ghidraVersion, installedEngineVersion, managedEngineVersion, verifiedJadxVersion, wabtVersion } from "./rea-engine-policy.js";
export const engineHost = () => ({ platform: process.platform, arch: process.arch });
const variables = { java: "JAVA_HOME", ghidra: "GHIDRA_INSTALL_DIR", hopper: "HOPPER_LAUNCHER_PATH", jadx: "REA_JADX_MCP_JAR", wabt: "REA_WABT_BIN_DIRECTORY" };
export function validEnginePath(value, platform = process.platform) {
    if (typeof value !== "string" || value.length > 4096 || /[\x00-\x1f\x7f]/.test(value) || value.includes("${"))
        return false;
    if (!value)
        return true;
    const normalized = value.replaceAll("\\", "/");
    return platform === "win32" ? win32.isAbsolute(value) && (/^[a-z]:\//i.test(normalized) || /^\/\/[^/?.][^/]*\/[^/]+(?:\/|$)/.test(normalized)) : posix.isAbsolute(value);
}
export function validEnginePaths(value) {
    return !!value && typeof value === "object" && !Array.isArray(value) && Object.entries(value).every(([id, path]) => reaEngineIds.includes(id) && validEnginePath(path));
}
export function engineEnvironment(paths = {}) {
    return Object.fromEntries(reaEngineIds.filter(id => paths[id]).map(id => [variables[id], paths[id]]));
}
export function engineInstallable(id, host = engineHost()) {
    const key = `${host.platform}-${host.arch}`;
    if (id === "hopper")
        return false; // Commercial installation and licensing remain user-managed.
    if (id === "ghidra")
        return ["win32-x64", "linux-x64", "darwin-x64", "darwin-arm64"].includes(key); // macOS builds its native components in the managed candidate.
    if (id === "java")
        return ["darwin-arm64", "darwin-x64", "linux-arm64", "linux-x64", "win32-x64", "win32-arm64"].includes(key);
    if (id === "wabt")
        return ["darwin-arm64", "linux-arm64", "linux-x64", "win32-x64"].includes(key);
    return ["darwin", "linux"].includes(host.platform) && ["x64", "arm64"].includes(host.arch) || host.platform === "win32" && host.arch === "x64";
}
function found(path) { return path && existsSync(path) ? path : ""; }
export function discoverEnginePaths(config = {}) {
    const paths = {};
    for (const id of reaEngineIds) {
        const value = config[id] || process.env[variables[id]];
        if (value && validEnginePath(value))
            paths[id] = value;
    }
    if (!paths.java) {
        const path = Object.entries(process.env).find(([key]) => key.toUpperCase() === "PATH")?.[1] ?? "";
        for (const directory of path.split(delimiter).filter(isAbsolute)) {
            try {
                const binary = realpathSync(join(directory, process.platform === "win32" ? "java.exe" : "java"));
                const home = dirname(dirname(binary));
                if (existsSync(join(home, "release"))) {
                    paths.java = home;
                    break;
                }
            }
            catch { /* Ignore missing PATH entries and OS launch stubs. */ }
        }
    }
    if (!paths.ghidra) {
        const directories = [join(homedir(), "Applications"), ...(process.platform === "darwin" ? ["/Applications"] : process.platform === "linux" ? ["/opt"] : [])];
        paths.ghidra = directories.map(directory => join(directory, `ghidra_${ghidraVersion}_PUBLIC`)).find(path => existsSync(join(path, "Ghidra", "application.properties")));
    }
    if (!paths.hopper && process.platform === "darwin")
        paths.hopper = found("/Applications/Hopper Disassembler.app/Contents/MacOS/hopper") || found(join(homedir(), "Applications/Hopper Disassembler.app/Contents/MacOS/hopper"));
    if (!paths.hopper && process.platform === "linux")
        paths.hopper = found("/opt/hopper/bin/Hopper");
    if (!paths.wabt) {
        const path = Object.entries(process.env).find(([key]) => key.toUpperCase() === "PATH")?.[1] ?? "";
        paths.wabt = path.split(delimiter).filter(isAbsolute).find(directory => existsSync(join(directory, process.platform === "win32" ? "wasm2wat.exe" : "wasm2wat")));
    }
    return paths;
}
export function engineValidationRevision(config, id, paths = discoverEnginePaths(config.engines)) {
    return `${reaEngineRevision(config, id)}:${["ghidra", "jadx"].includes(id) ? paths.java ?? "" : ""}`;
}
export function listEngines(config, previous = [], host = engineHost()) {
    const paths = discoverEnginePaths(config.engines);
    return reaEngineIds.map(id => {
        const path = paths[id] || "", configured = !!config.engines?.[id];
        const installable = maintenanceProcessSupported(host.platform) && engineContractSupported(config.installation?.version) && engineInstallable(id, host);
        const unsupported = !["darwin", "linux", "win32"].includes(host.platform) || !["arm64", "x64"].includes(host.arch) || id === "hopper" && host.platform === "win32" || ["ghidra", "jadx"].includes(id) && host.platform === "win32" && host.arch !== "x64";
        const revision = reaEngineRevision(config, id), validationRevision = engineValidationRevision(config, id, paths);
        const old = previous.find(item => item.id === id && item.path === path && item.configured === configured && item.validationRevision === validationRevision);
        const owned = { revision, validationRevision, managed: !!config.managedEngines?.[id]?.length, activeManaged: !!config.managedEngines?.[id]?.some(record => record.path === path), removalPending: !!config.removalPending?.some(name => name.startsWith(`${id}-`)) };
        const present = !!path && existsSync(path);
        const version = present ? installedEngineVersion(id, path) ?? (old?.checkedAt ? old.version : managedEngineVersion(config.managedEngines?.[id]?.find(record => record.path === path)) ?? old?.version) : undefined;
        const policy = engineVersionPolicy(id, version, config.installation?.version);
        if (old && !unsupported && present)
            return { ...old, version, ...policy, installable, ...owned };
        return { id, path, version, ...policy, configured, installable, ...owned, status: unsupported ? "unsupported" : present ? "unchecked" : "missing", detail: unsupported ? "当前 REA 平台不支持此引擎。" : "点击检查更新以验证本地组件。" };
    });
}
export async function checkEngines(root, config, packageRoot, signal, run = runEngine, only) {
    const paths = discoverEnginePaths(config.engines), env = { ...reaProcessEnvironment(root, config), ...engineEnvironment(paths) }, items = listEngines(config);
    const binary = (home, name) => join(home, process.platform === "win32" ? `${name}.exe` : name);
    for (const item of items) {
        if (only && item.id !== only)
            continue;
        signal.throwIfAborted();
        item.checkedAt = Date.now();
        if (item.status === "unsupported" || !item.path)
            continue;
        const environmentDirectory = join(reaDirectory(root), "environment", "engines", item.id);
        try {
            if (!existsSync(item.path)) {
                item.status = "missing";
                item.detail = "配置路径不存在，请检查后台电脑上的路径。";
                continue;
            }
            if (item.id === "hopper") {
                accessSync(item.path, constants.X_OK);
                if (!statSync(item.path).isFile())
                    throw Error("Hopper 路径必须指向可执行文件。");
                item.version = installedEngineVersion(item.id, item.path);
                item.status = "detected";
                item.detail = "启动程序存在；未启动 GUI，版本、许可及实际桥接需在使用时验证。";
            }
            else if (item.id === "java") {
                const executable = binary(join(item.path, "bin"), "java");
                const version = await run(executable, ["-XshowSettings:properties", "-version"], { cwd: root, env, environmentDirectory, signal });
                const modules = await run(executable, ["--list-modules"], { cwd: root, env, environmentDirectory, signal });
                item.version = installedEngineVersion(item.id, item.path) ?? /java.version\s*=\s*([^\s]+)/.exec(version.stderr + version.stdout)?.[1];
                if (version.code || modules.code || !/^jdk.compiler@/m.test(modules.stdout) || !item.version || Number(item.version.split(".")[0]) < 17)
                    throw Error("需要 JDK 17+ 且包含 jdk.compiler；推荐 JDK 21。Ghidra 另按安装声明验证 Java 范围。");
                item.status = "ready";
                item.detail = "Java 属性与编译模块检查通过；Ghidra 兼容性请同时查看其检测结果。";
            }
            else if (item.id === "wabt") {
                for (const name of ["wasm-validate", "wasm-objdump", "wasm2wat"]) {
                    const result = await run(binary(item.path, name), ["--version"], { cwd: root, env, environmentDirectory, signal });
                    if (name === "wasm-validate")
                        item.version = /^\d+\.\d+\.\d+$/.test(result.stdout.trim()) ? result.stdout.trim() : undefined;
                    if (result.code || result.stderr.trim() || result.stdout.trim() !== wabtVersion)
                        throw Error(`${name} 需为 ${wabtVersion} 且匹配后台系统架构。`);
                }
                item.version = wabtVersion;
                item.status = "ready";
                item.detail = "三个 WASM 工具的版本检查通过，未加载分析目标。";
            }
            else {
                if (!packageRoot || !engineContractSupported(config.installation?.version))
                    throw Error(`当前检测契约验证于 REA ${engineContractVersion}；请先安装该版本或等待适配新版本。`);
                const { entry } = inspectReaProgram(packageRoot, config.installation.version);
                const result = await run(reaNode(root, config), [entry, "doctor", "--provider", item.id, "--skill=false", "--format", "json"], { cwd: root, env, environmentDirectory, signal, timeout: 60_000 });
                const report = JSON.parse(result.stdout);
                if (![0, 1].includes(result.code) || !Array.isArray(report.scope_checks) || !report.scope_checks.length || typeof report.healthy !== "boolean")
                    throw Error("REA 未返回有效的组件检查报告。");
                const failed = report.scope_checks.filter((check) => check.ok !== true);
                item.status = report.healthy && !failed.length ? "ready" : "incompatible";
                if (item.id === "jadx" && item.status === "ready")
                    item.version = await verifiedJadxVersion(item.path, signal);
                item.detail = failed.length ? failed.map((check) => `${check.name}: ${check.detail ?? "未通过"}`).join("\n").slice(0, 4000) : item.status === "ready" ? "REA 环境检查通过；未加载目标，不代表实际分析桥接已通过。" : "REA 检查未通过，请检查引擎与 Java 配置。";
            }
        }
        catch (error) {
            signal.throwIfAborted();
            if (error instanceof MaintenanceError)
                throw error;
            item.status = "error";
            item.detail = error instanceof Error ? error.message : "组件检测失败。";
        }
        Object.assign(item, engineVersionPolicy(item.id, item.version, config.installation?.version));
    }
    return items;
}
//# sourceMappingURL=rea-engines.js.map