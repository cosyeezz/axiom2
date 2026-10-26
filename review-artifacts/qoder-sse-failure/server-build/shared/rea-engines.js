export const reaEngineContractVersion = "6.7.0";
export const reaEngineContractVersions = ["6.7.0", "6.8.0"];
export const supportedReaEngineContract = (version) => reaEngineContractVersions.some(item => item === version);
export const reaEngineIds = ["java", "ghidra", "hopper", "jadx", "wabt"];
export const reaEngineLabels = { java: "JDK 21", ghidra: "Ghidra", hopper: "Hopper", jadx: "JADX Headless", wabt: "WABT" };
export const reaEngineStatusLabels = {
    unchecked: "未检测", missing: "未找到", ready: "环境检查通过", detected: "已发现 · 待运行验证", incompatible: "不兼容", unsupported: "平台不支持", error: "检测失败",
};
export const reaEngineDescriptions = {
    java: "Ghidra 与 JADX 使用的完整 Java 开发环境；托管安装不修改系统 Java。",
    ghidra: "原生程序反编译。REA 6.7.0 验证 12.1.4，接受 12.1.x；需要兼容 JDK 和本机架构的反编译程序。",
    hopper: "原生程序反编译。可下载官方试用版；安装、商业许可和首次启动由 Hopper 管理，版本匹配不代表许可或桥接通过。",
    jadx: "Android APK 反编译。需要 jadx-headless-mcp 0.7.1 JAR，不是普通 jadx 命令；需要完整 JDK。",
    wabt: "WASM 文件分析。使用 WABT 1.0.42 的 wasm-validate、wasm-objdump 和 wasm2wat。",
};
export const reaEnginePathLabels = {
    java: "JDK Home 目录（macOS 通常为 Contents/Home）", ghidra: "Ghidra 解压根目录", hopper: "Hopper 启动程序的绝对路径", jadx: "jadx-headless-mcp JAR 文件", wabt: "WABT bin 目录",
};
export function compareEngineVersions(left, right) {
    // Adoptium semver uses +9.0.LTS; the installed release file uses +9-LTS.
    const parts = (value) => /^(\d+(?:\.\d+){0,3})(?:\+(\d+(?:\.\d+)*)(?:\.LTS)?)?(?:-LTS)?$/.exec(value);
    const a = parts(left), b = parts(right);
    if (!a || !b)
        return;
    for (const group of [1, 2]) {
        const l = (a[group] ?? "0").split(".").map(Number), r = (b[group] ?? "0").split(".").map(Number);
        for (let i = 0; i < Math.max(l.length, r.length); i++)
            if ((l[i] ?? 0) !== (r[i] ?? 0))
                return (l[i] ?? 0) > (r[i] ?? 0) ? 1 : -1;
    }
    return 0;
}
export function engineRecommendationSatisfied(engine) {
    const recommended = engine.available?.version ?? engine.recommendedVersion;
    return !!engine.version && !!recommended && compareEngineVersions(engine.version, recommended) === 0 && !["missing", "error", "incompatible", "unsupported"].includes(engine.status);
}
export function engineDownloadSatisfied(engine) {
    const recommended = engine.available?.version ?? engine.recommendedVersion;
    return !!engine.download && !!recommended && compareEngineVersions(engine.download.version, recommended) === 0;
}
export function isReaEngineId(value) { return typeof value === "string" && reaEngineIds.includes(value); }
//# sourceMappingURL=rea-engines.js.map