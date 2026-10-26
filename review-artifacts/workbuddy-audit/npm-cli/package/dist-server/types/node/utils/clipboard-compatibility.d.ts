export interface ClipboardCompatibilityResult {
    isSupported: boolean;
    missingTools?: string[];
    platform: string;
    /** 终端是否支持直接粘贴图片数据 */
    terminalSupportsImagePaste?: boolean;
    /** 图片粘贴限制说明 */
    imagePasteLimitation?: string;
}
/**
 * 终端图片粘贴支持级别
 */
export declare enum TerminalImagePasteSupport {
    /** 完全支持：终端支持图片粘贴，系统工具可用 */
    FULL = "full",
    /** 部分支持：需要通过系统剪贴板读取，可能有延迟 */
    PARTIAL = "partial",
    /** 不支持：终端不传输图片数据，需要使用文件路径 */
    NONE = "none"
}
export declare abstract class ClipboardCompatibilityUtils {
    /**
     * 检查平台剪贴板兼容性
     */
    static checkPlatformCompatibility(): Promise<ClipboardCompatibilityResult>;
    /**
     * 检查终端对图片粘贴的支持级别
     *
     * 不同终端对图片粘贴的支持程度不同：
     * - 大多数现代终端支持 Bracketed Paste，但只传输文本
     * - 图片数据需要通过系统剪贴板工具读取
     * - Kitty 等终端有自己的图片协议，但不通过粘贴传输
     */
    static getTerminalImagePasteSupport(): {
        support: TerminalImagePasteSupport;
        limitation?: string;
        suggestion?: string;
    };
}
