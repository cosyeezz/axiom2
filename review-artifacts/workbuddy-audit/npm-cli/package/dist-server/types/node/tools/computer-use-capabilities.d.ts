/**
 * macOS 平台硬过滤。Windows / Linux 下工具完全禁用。
 */
export declare function isDarwin(): boolean;
/**
 * 探测 cliclick 是否可用。cliclick 提供比 AppleScript 更快更准确的鼠标/键盘操作，
 * 但需要用户通过 Homebrew 安装。未安装时 fallback 到 osascript。
 *
 * 检测方式：which cliclick，有输出且返回 0 即可用。结果缓存。
 */
export declare function detectCliclick(): Promise<string | null>;
/**
 * 计算本次 cbc 进程的 computer-use 截图目录，按需创建。
 * 路径：<home>/computer-use/  （home 支持 CODEBUDDY_CONFIG_DIR 重定向）
 *
 * 不按 session/project 分目录 —— computer use 操作本身和当前会话关系紧密，
 * 但截图作为调试/审计产物，统一放一起便于用户清理。
 */
export declare function getComputerUseDir(): string;
/**
 * 仅测试用：重置缓存，便于 spec 里多次断言不同平台分支。
 */
export declare function __resetComputerUseCapabilitiesCacheForTest(): void;
