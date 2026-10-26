import { LatencyBuffer } from "../shared/latency.js";
// Scope diagnostics to the server/store lifetime, including isolated test servers.
const buffers = new WeakMap();
export function latencyFor(owner) {
    let buffer = buffers.get(owner);
    if (!buffer) {
        buffer = new LatencyBuffer();
        buffers.set(owner, buffer);
    }
    return buffer;
}
//# sourceMappingURL=latency.js.map