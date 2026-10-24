export const reaEngineIds = ["java", "ghidra", "hopper", "jadx", "wabt"] as const;
export type ReaEngineId = typeof reaEngineIds[number];
export type ReaEnginePaths = Partial<Record<ReaEngineId, string>>;
export type ReaEngineStatus = "unchecked" | "missing" | "ready" | "detected" | "incompatible" | "unsupported" | "error";
export type ReaEngineState = {
  id: ReaEngineId;
  path: string;
  configured: boolean;
  status: ReaEngineStatus;
  detail: string;
  version?: string;
  checkedAt?: number;
  installable: boolean;
  managed?: boolean;
  removalPending?: boolean;
};
export const reaEngineLabels: Record<ReaEngineId, string> = { java: "JDK 21", ghidra: "Ghidra", hopper: "Hopper", jadx: "JADX Headless", wabt: "WABT" };
export const reaEngineStatusLabels: Record<ReaEngineStatus, string> = {
  unchecked: "未检测", missing: "未找到", ready: "环境检查通过", detected: "已发现 · 待运行验证", incompatible: "不兼容", unsupported: "平台不支持", error: "检测失败",
};
export const reaEngineDescriptions: Record<ReaEngineId, string> = {
  java: "Ghidra 与 JADX 使用的完整 Java 开发环境；托管安装不修改系统 Java。",
  ghidra: "原生程序反编译。REA 6.7.0 验证 12.1.4，接受 12.1.x；需要兼容 JDK 和本机架构的反编译程序。",
  hopper: "原生程序反编译。接入已有安装；商业许可、试用限制和首次启动对话框需自行处理。",
  jadx: "Android APK 反编译。需要 jadx-headless-mcp 0.7.1 JAR，不是普通 jadx 命令；需要完整 JDK。",
  wabt: "WASM 文件分析。使用 WABT 1.0.42 的 wasm-validate、wasm-objdump 和 wasm2wat。",
};
export const reaEnginePathLabels: Record<ReaEngineId, string> = {
  java: "JDK Home 目录（macOS 通常为 Contents/Home）", ghidra: "Ghidra 解压根目录", hopper: "Hopper 启动程序的绝对路径", jadx: "jadx-headless-mcp JAR 文件", wabt: "WABT bin 目录",
};
export function isReaEngineId(value: unknown): value is ReaEngineId { return typeof value === "string" && reaEngineIds.includes(value as ReaEngineId); }
