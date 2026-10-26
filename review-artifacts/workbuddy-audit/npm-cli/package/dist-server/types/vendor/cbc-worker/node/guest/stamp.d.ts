/**
 * Placeholder for the stamp that tags callbacks arriving synchronously from the worker with the
 * plugin and environment they belong to (a SharedArrayBuffer handed in through workerData).
 * Nothing writes it yet; only the slot is reserved so the protocol does not change when it lands.
 */
export interface StampSlot {
    readonly buffer: SharedArrayBuffer;
    readonly view: Int32Array;
}
export declare function readStamp(workerData: unknown): StampSlot | undefined;
//# sourceMappingURL=stamp.d.ts.map