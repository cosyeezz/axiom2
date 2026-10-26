/** The image operations used by model input preparation and compression. */
export interface ImageCodecImage {
    readonly bitmap: {
        width: number;
        height: number;
    };
    getMIME(): string;
    /** Unknown opacity keeps the original format before trying JPEG compression. */
    hasAlpha?(): boolean;
    quality(value: number): ImageCodecImage;
    resize(width: number, height: number): ImageCodecImage;
    encode(mimeType: string): Promise<{
        data: Buffer;
        mimeType: string;
    }>;
}
/** Node/Cloud use the existing Jimp decoder; hosts may select a native codec at build time. */
export declare function readImage(input: Buffer, _options?: {
    validate?: boolean;
}): Promise<ImageCodecImage>;
