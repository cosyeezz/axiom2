/** Fixed-capacity ring; a busy stream must not make diagnostics grow without bound. */
export class LatencyBuffer {
    capacity;
    records = [];
    cursor = 0;
    constructor(capacity = 2000) {
        this.capacity = capacity;
        if (!Number.isInteger(capacity) || capacity < 1)
            throw Error("Invalid latency buffer capacity");
    }
    add(record) {
        // Pick fields explicitly even when the caller is JavaScript or IPC.
        const entry = { stage: record.stage.slice(0, 64), at: record.at };
        for (const key of ["runId", "requestId", "streamId", "connectionId", "code"])
            if (typeof record[key] === "string")
                entry[key] = record[key].slice(0, 160);
        if (record.purpose === "session" || record.purpose === "auxiliary")
            entry.purpose = record.purpose;
        for (const key of ["updateId", "seq", "durationMs", "attempt", "status", "bytes"])
            if (Number.isFinite(record[key]))
                entry[key] = record[key];
        if (this.records.length < this.capacity)
            this.records.push(entry);
        else {
            this.records[this.cursor] = entry;
            this.cursor = (this.cursor + 1) % this.capacity;
        }
    }
    snapshot(runId) {
        const ordered = [...this.records.slice(this.cursor), ...this.records.slice(0, this.cursor)];
        return ordered.filter(record => !runId || record.runId === runId).map(record => ({ ...record }));
    }
}
//# sourceMappingURL=latency.js.map