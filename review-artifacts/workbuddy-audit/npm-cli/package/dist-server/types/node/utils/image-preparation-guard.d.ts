/**
 * 不可信图片进入统一 preparation 边界时的硬上限。
 *
 * - 压缩字节：必须在 `Buffer.from(base64)` 前估算，避免超大 MCP/data URL 再制造一份
 *   Buffer 与 round-trip Base64 副本。
 * - 尺寸/像素：必须在 Jimp 解码前从格式头读取，避免压缩体很小的 decompression bomb
 *   展开为无界 RGBA bitmap。
 *
 * 5 MiB 覆盖当前模型入口的常规图片；40 MP 对 8K 截图留有余量，同时把单张 RGBA
 * 展开内存限制在约 160 MiB。单边再封顶 32768，防止极端窄长图片触发解码器内部溢出。
 */
export declare const MAX_PREPARED_IMAGE_BYTES: number;
export type Base64PayloadInspection = {
    ok: true;
    estimatedBytes: number;
} | {
    ok: false;
    reason: string;
};
/**
 * 在创建规范化 Base64 副本前完成字符校验与解码字节估算。
 * 允许 MIME data URL 常见的空白折行，但空白不计入编码长度。
 */
export declare function inspectImageBase64Payload(value: string, start: number): Base64PayloadInspection;
export declare function validateImageDimensionsBeforeDecode(buffer: Buffer, mimeType: string): string | undefined;
/**
 * Jimp 0.22 不包含 WebP decoder；这里以 fail-closed 方式校验有界 RIFF/chunk 结构、
 * frame header、partition 边界与尺寸，防止仅凭 `RIFF....WEBP` 签名放行伪图片。
 */
export declare function validateWebPStructure(buffer: Buffer): string | undefined;
/**
 * 以 fail-closed 方式校验 PNG 的 chunk 结构：签名、IHDR 字段合法性、chunk 边界、
 * IDAT 存在、以 IEND 终止。
 *
 * IEND 之后的字节不属于 PNG 数据流，不再解析：规范虽要求 IEND 为最后内容，但 libpng
 * 与浏览器读到 IEND 即停，实际文件（如带尾随字节的导出 APNG）也会携带这类尾巴。
 * 这里若拒绝，整张图会在历史与模型请求中被替换成占位文本。
 *
 * 只走容器结构、不解 zlib 像素流，代价是 O(chunk 数) 而不是整图解码。
 */
export declare function validatePngStructure(buffer: Buffer): string | undefined;
/**
 * 以 fail-closed 方式校验 JPEG 的 marker 段结构：SOI、段长度边界、存在 SOF 帧头与
 * SOS 扫描段，并用 EOI 终止符排除截断。
 *
 * 与 `readJpegDimensions` 共用同一套段遍历规则，但这里关心的是完整性而非尺寸。
 */
export declare function validateJpegStructure(buffer: Buffer): string | undefined;
/**
 * 模型可直接消费的格式（JPEG / PNG / WebP）只做容器结构校验，不做整图解码。
 *
 * 解码唯一能多提供的信息是"熵编码 / zlib 像素流能否解开"，但代价高得不成比例：
 * 实测单张 10MB 图的一次纯校验解码要制造约 44MB 瞬时垃圾、耗时约 90ms，占一次
 * `Read` 全链路开销的约 24%（取证见
 * `scripts/reproduce/read-many-large-images-oom/image-copy-checkpoints-probe.mjs`）。
 * WebP 本来就没有解码器可用、一直只做结构校验，这里把 JPEG/PNG 统一到同一口径。
 *
 * 需要转码的格式（BMP/TIFF/GIF）仍然必须解码，因为要重新编码成 PNG。
 */
export declare function validateModelVisionImageStructure(buffer: Buffer, mimeType: string): string | undefined;
