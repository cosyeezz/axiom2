export declare class FetchError extends Error {
    code?: string | undefined;
    constructor(message: string, code?: string | undefined);
}
export declare abstract class UrlUtils {
    static PRIVATE_IP_RANGES: RegExp[];
    static isPrivateIp(url: string): boolean;
    static extractUrls(text: string): string[];
    static isLocalhost(url: string): boolean;
    static validateUrl(url: string | URL): void;
    static openUrl(url: string): Promise<boolean>;
    private static executeCommand;
}
