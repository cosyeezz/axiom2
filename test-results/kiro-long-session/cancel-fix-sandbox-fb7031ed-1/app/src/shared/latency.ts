/** Diagnostic metadata only: never provider payloads, headers, URLs, or error text. */
export interface DeliveryTiming {
  runId: string;
  requestId: string;
  updateId: number;
  workerAt: number;
  receivedAt?: number;
  connectionId?: string;
}
export interface LatencyRecord {
  stage: string;
  at: number;
  runId?: string;
  requestId?: string;
  updateId?: number;
  streamId?: string;
  connectionId?: string;
  seq?: number;
  durationMs?: number;
  attempt?: number;
  status?: number;
  bytes?: number;
  code?: string;
  purpose?: "session" | "auxiliary";
}
/** Fixed-capacity ring; a busy stream must not make diagnostics grow without bound. */
export class LatencyBuffer {
  private records: LatencyRecord[] = [];
  private cursor = 0;
  constructor(readonly capacity = 2000) {
    if (!Number.isInteger(capacity) || capacity < 1) throw Error("Invalid latency buffer capacity");
  }
  add(record: LatencyRecord) {
    // Pick fields explicitly even when the caller is JavaScript or IPC.
    const entry: LatencyRecord = { stage: record.stage.slice(0, 64), at: record.at };
    for (const key of ["runId", "requestId", "streamId", "connectionId", "code"] as const)
      if (typeof record[key] === "string") entry[key] = record[key]!.slice(0, 160);
    if (record.purpose === "session" || record.purpose === "auxiliary") entry.purpose = record.purpose;
    for (const key of ["updateId", "seq", "durationMs", "attempt", "status", "bytes"] as const)
      if (Number.isFinite(record[key])) entry[key] = record[key];
    if (this.records.length < this.capacity) this.records.push(entry);
    else { this.records[this.cursor] = entry; this.cursor = (this.cursor + 1) % this.capacity; }
  }
  snapshot(runId?: string) {
    const ordered = [...this.records.slice(this.cursor), ...this.records.slice(0, this.cursor)];
    return ordered.filter(record => !runId || record.runId === runId).map(record => ({ ...record }));
  }
}
