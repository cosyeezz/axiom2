/** 每条输出流独立保护 UTF-8 边界，并保留原有非 UTF-8 解码策略。 */
export declare class ShellOutputDecoder {
    private readonly decode;
    private pending;
    constructor(platform?: NodeJS.Platform);
    write(data: Buffer): string;
    end(): string;
}
