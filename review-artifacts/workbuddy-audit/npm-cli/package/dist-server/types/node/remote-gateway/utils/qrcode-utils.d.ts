export interface QRCodeOptions {
    /** QR 码版本（1-40），版本越高矩阵越大。不指定时自动选择最小版本。 */
    version?: number;
}
/**
 * 生成终端友好的 UTF-8 QR 码字符串。
 *
 * 使用 Unicode 半块字符（▀▄█ 等）渲染，在终端中紧凑显示。
 * 适合手机扫码场景。
 */
export declare function generateTerminalQRCode(data: string, options?: QRCodeOptions): Promise<string>;
/**
 * 计算给定数据所需的最小 QR 码版本。
 * 用于在多个 QR 码之间统一尺寸。
 */
export declare function getQRCodeVersion(data: string): Promise<number>;
