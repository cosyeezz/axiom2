import { type ClipboardCompatibilityResult } from './clipboard-compatibility';
export interface ClipboardImageData {
    data: Buffer;
    format: string;
    tempFilePath: string;
}
export declare abstract class ClipboardUtils {
    /**
     * 默认重试配置
     * 用于处理截图工具写入剪贴板的时序问题
     * macOS 系统截图可能需要更长的时间写入剪贴板
     */
    private static readonly DEFAULT_RETRY_CONFIG;
    /**
     * 带重试的延迟函数
     */
    private static delay;
    /**
     * 检查剪贴板中是否有图片数据
     * @param options 可选配置，支持重试以处理截图工具写入延迟
     */
    static hasImage(options?: {
        retry?: boolean;
    }): Promise<boolean>;
    /**
     * 从剪贴板读取图片数据
     * @param options 可选配置，支持重试以处理截图工具写入延迟
     */
    static readImage(options?: {
        retry?: boolean;
    }): Promise<ClipboardImageData | undefined>;
    /**
     * macOS 剪贴板支持的图片格式
     * 扩展格式列表以支持更多截图工具（包括企业微信等第三方截图工具）
     */
    private static readonly MACOS_IMAGE_FORMATS;
    /**
     * macOS 剪贴板中可能表示图片存在的动态 UTI 格式前缀
     * 部分第三方应用（如企业微信）使用动态 UTI 格式写入剪贴板
     */
    private static readonly MACOS_DYNAMIC_IMAGE_PREFIXES;
    /**
     * macOS 平台检查剪贴板图片
     * 除了检查已知格式外，还通过 pngpaste 进行兜底检测，
     * 以支持企业微信等使用非标准格式写入剪贴板的第三方截图工具
     */
    private static hasImageMacOS;
    /**
     * 通过尝试实际读取来探测剪贴板中是否包含图片
     * 当格式检测不确定时作为兜底方案
     */
    private static probeImageMacOS;
    /**
     * 检查平台剪贴板兼容性
     */
    static checkPlatformCompatibility(): Promise<ClipboardCompatibilityResult>;
    /**
     * 检查 pngpaste 是否可用
     */
    private static isPngpasteAvailable;
    /**
     * 在 tmux 环境中同步 tmux 缓冲区到系统剪贴板 (macOS)
     * 尝试将 tmux 的粘贴缓冲区内容复制到系统剪贴板,以便后续工具能访问
     */
    private static syncTmuxToSystemClipboard;
    /**
     * 使用 osascript 读取剪贴板图片作为 pngpaste 的后备方案
     * 依次尝试 AppleScript 格式读取和 Swift NSPasteboard API，
     * 以兼容企业微信等第三方截图工具
     */
    private static readImageMacOSFallback;
    /**
     * 使用 AppleScript 按格式读取剪贴板图片
     */
    private static readImageWithAppleScript;
    /**
     * 使用 osascript -l JavaScript (JXA) 通过 NSPasteboard API 读取剪贴板图片
     * 这种方式能处理所有图片格式，包括企业微信等第三方截图工具的非标准格式
     *
     * 原理：通过 ObjC bridge 直接调用 Cocoa 的 NSPasteboard/NSImage API，
     * 将剪贴板中的任意图片数据转换为 PNG 格式写入文件
     */
    private static readImageWithNSPasteboard;
    /**
     * macOS 平台读取剪贴板图片
     */
    private static readImageMacOS;
    /**
     * 使用 pngpaste 读取剪贴板图片
     */
    private static readImageMacOSWithPngpaste;
    /**
     * Windows 平台检查剪贴板图片
     */
    private static hasImageWindows;
    /**
     * Windows 平台读取剪贴板图片
     */
    private static readImageWindows;
    /**
     * Linux 平台检查剪贴板图片
     */
    private static hasImageLinux;
    /**
     * Linux 平台读取剪贴板图片
     */
    private static readImageLinux;
    /**
     * 读取 Windows 剪贴板文本（含 WSL）；不支持或读取失败时返回 undefined。
     */
    static readTextFromClipboard(): Promise<string | undefined>;
    private static readTextFromClipboardWindows;
    /**
     * 将文本复制到剪贴板
     *
     * 在 SSH 远程环境中，会优先使用 OSC 52 协议，
     * 这允许远程程序通过终端转义序列访问本地剪贴板。
     */
    static copyToClipboard(text: string): Promise<boolean>;
    /**
     * 清理临时文件
     */
    static cleanupTempFile(filePath: string): void;
    /**
     * 获取剪贴板中的文件路径列表
     * 支持 macOS、Windows 和 Linux 平台
     */
    static getClipboardFiles(): Promise<string[]>;
    /**
     * macOS 平台获取剪贴板文件
     */
    private static getClipboardFilesMacOS;
    /**
     * Windows 平台获取剪贴板文件
     */
    private static getClipboardFilesWindows;
    /**
     * Linux 平台获取剪贴板文件
     * 使用 xclip 或 xsel 工具
     */
    private static getClipboardFilesLinux;
}
