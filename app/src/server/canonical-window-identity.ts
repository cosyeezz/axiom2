import { createHmac, randomBytes } from "node:crypto";
import type { Scope } from "../shared/protocol.js";

const newSeed = () => randomBytes(32).toString("hex");
function signer(seed: string) {
  if (!/^[a-f0-9]{64}$/.test(seed)) throw new TypeError("Invalid window identity seed");
  const secret = Buffer.from(seed, "hex");
  return (parts: readonly string[]) => createHmac("sha256", secret).update(JSON.stringify(parts)).digest();
}
/** A host-lifetime namespace, independently derived per authorized scope. No
 * per-session registry or persisted secret. Send a scope seed only to its worker,
 * never the root. Callers MUST check ownership before deriving a seed. */
export function createWindowIdentityScopes(root = newSeed()) {
  const sign = signer(root);
  return (scope: Scope) => sign(["scope-v1", scope.workspaceId, scope.sessionId]).toString("hex");
}
/** Display/equality keys only. These do not grant reads, actions, domain presence
 * or readiness. Immutable snapshot refs and run/lease guards remain authoritative.
 * Host restart changes the namespace; ordinary body updates and owner handoffs do not. */
export function createWindowIdentity(seed = newSeed()) {
  const sign = signer(seed);
  return Object.freeze({
    /** Streaming, length-delimited UTF-16 preserves lone surrogates exactly. */
    version: (domain: string, parts: Iterable<string>) => {
      const hash = createHmac("sha256", Buffer.from(seed, "hex"));
      const append = (value: string) => hash.update(`${value.length}:`).update(Buffer.from(value, "utf16le"));
      append("version-v1"); append(domain);
      for (const part of parts) append(part);
      return `v_${hash.digest("base64url")}`;
    },
    namespace: `w_${sign(["namespace-v1"]).toString("base64url")}`,
    key: (kind: "message" | "call" | "run" | "input" | "source" | "occurrence" | "task" | "task-result", id: string) =>
      `k_${sign(["entity-v1", kind, id]).toString("base64url")}`,
  });
}
