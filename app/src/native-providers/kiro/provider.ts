import type { NativeAuthInteraction, NativeOAuth, NativeOAuthCredential } from "../contracts.js";
import { waitForNative } from "../abort.js";
import { createKiroOAuth, type KiroCredential } from "./auth.js";
import { fetchKiroCatalog } from "./catalog.js";
import { createKiroClient } from "./client.js";

/** An in-process component instance. Host storage and tool execution remain host-owned. */
export function createKiroNativeProvider(options: Parameters<typeof createKiroOAuth>[0] = {}) {
  const lifetime = new AbortController(), oauth = createKiroOAuth(options), client = createKiroClient(options.fetch);
  const bounded = (signal: AbortSignal) => AbortSignal.any([lifetime.signal, signal]);
  const auth: NativeOAuth<KiroCredential> = {
    login(interaction: NativeAuthInteraction) {
      const signal = bounded(interaction.signal); signal.throwIfAborted();
      return waitForNative(oauth.login({ ...interaction, signal }), signal);
    },
    refresh(credential: NativeOAuthCredential, requested: AbortSignal) {
      const signal = bounded(requested); signal.throwIfAborted();
      return waitForNative(oauth.refresh(credential, signal), signal);
    },
  };
  return {
    id: "kiro" as const,
    auth,
    catalog(credential: KiroCredential, requested: AbortSignal) {
      const signal = bounded(requested); signal.throwIfAborted();
      return fetchKiroCatalog(credential, signal, options.fetch);
    },
    stream: client.stream,
    dispose() { lifetime.abort(); client.dispose(); },
  };
}
