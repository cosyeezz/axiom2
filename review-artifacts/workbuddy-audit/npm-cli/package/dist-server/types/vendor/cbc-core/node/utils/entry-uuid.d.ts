/** JSONL entry identity. Missing IDs are minted once and written back; no collision scan. */
export declare function entryUuidOf(item: unknown): string;
/** Reuse the pre-stream entry ID on the history copy; leave SDK item/response IDs untouched. */
export declare function remintModelItemId<T extends {
    id?: string;
    providerData?: Record<string, any>;
}>(item: T): T;
//# sourceMappingURL=entry-uuid.d.ts.map