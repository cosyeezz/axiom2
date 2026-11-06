import { randomBytes } from "node:crypto";

// RFC 9562 UUIDv7, using the CLI 2.179.0 48-bit timestamp / 42-bit
// monotonic counter / 32-bit random tail layout. Encoded without hyphens.
let timestamp = 0, counter = 0;
export function codeBuddyUuid7(): string {
  const now = Date.now();
  if (now > timestamp) {
    timestamp = now;
    counter = randomBytes(6).readUIntBE(0, 6) % 0x40000000000;
  } else if (++counter >= 0x40000000000) { timestamp++; counter = 0; }
  const bytes = Buffer.alloc(16);
  bytes.writeUIntBE(timestamp, 0, 6);
  bytes.writeUInt16BE(0x7000 | Math.floor(counter / 0x40000000), 6);
  bytes.writeUInt32BE((0x80000000 + counter % 0x40000000) >>> 0, 8);
  randomBytes(4).copy(bytes, 12);
  return bytes.toString("hex");
}

export function codeBuddySessionId(): string {
  return codeBuddyUuid7().replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, "$1-$2-$3-$4-$5");
}

/** RAM-only host-to-provider aliases. No host identifiers enter the protocol.
 * Scoped to one provider runtime and cleared on disposal/account invalidation.
 * Do not evict active IDs by count: that can split one run across protocol identities.
 * Does not claim CLI cross-process restoration.
 */
export function createCodeBuddyIdentityScope() {
  const sessions = new Map<string, { id: string; runs: Map<string, string> }>();
  return {
    resolve(session?: string, run?: string) {
      let entry = session ? sessions.get(session) : undefined;
      if (!entry) {
        entry = { id: codeBuddySessionId(), runs: new Map() };
        if (session) {
          sessions.set(session, entry);
        }
      }
      let request = run ? entry.runs.get(run) : undefined;
      if (!request) {
        request = codeBuddyUuid7();
        if (run) {
          entry.runs.set(run, request);
        }
      }
      return { sessionId: entry.id, continuationId: request };
    },
    clear() { sessions.clear(); },
  };
}
