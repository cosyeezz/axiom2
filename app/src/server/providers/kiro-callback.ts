import { kiroCallback as nativeCallback } from "../../native-providers/kiro/callback.js";

/** Host branding only; callback validation and lifecycle belong to the component. */
export function kiroCallback(state: string, signal: AbortSignal, options: Parameters<typeof nativeCallback>[2] = {}) {
  return nativeCallback(state, signal, { ...options, applicationName: "Axiom" });
}
