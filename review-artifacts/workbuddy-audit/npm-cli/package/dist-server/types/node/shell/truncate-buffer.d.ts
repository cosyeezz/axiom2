export declare class TruncateBuffer {
    private readonly headLimit;
    private readonly tailLimit;
    private headBuf;
    private tailBuf;
    private truncatedBytes;
    private totalLines;
    constructor(headLimit?: number, tailLimit?: number);
    push(data: string): void;
    toString(withMarker?: boolean): string;
    getEndOffset(): number;
    readSince(offset: number): {
        content: string;
        fromOffset: number;
        nextOffset: number;
        omittedLength: number;
    };
    isEmpty(): boolean;
    getHead(): string;
    getTail(): string;
    getTruncatedBytes(): number;
    getTotalLines(): number;
    clear(): void;
}
