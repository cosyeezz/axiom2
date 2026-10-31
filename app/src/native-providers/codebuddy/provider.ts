import type { NativeAuthInteraction, NativeOAuth, NativeOAuthCredential } from "../contracts.js";
import { waitForNative } from "../abort.js";
import { createCodeBuddyOAuth, type CodeBuddyOAuthOptions } from "./auth.js";
import { createCodeBuddyCatalog } from "./catalog.js";
import { createCodeBuddyClient } from "./client.js";

/** In-process CN component; no implicit login, credential storage, refresh loop or tool execution. */
export function createCodeBuddyNativeProvider(options: CodeBuddyOAuthOptions = {}) {
  const lifetime = new AbortController(), oauth = createCodeBuddyOAuth(options);
  const catalog = createCodeBuddyCatalog(options.fetch), client = createCodeBuddyClient(options.fetch);
  const bounded = (signal: AbortSignal) => AbortSignal.any([lifetime.signal, signal]);
  const auth: NativeOAuth<NativeOAuthCredential> = {
    login(interaction: NativeAuthInteraction) {
      const signal = bounded(interaction.signal); signal.throwIfAborted();
      return waitForNative(oauth.login({ ...interaction, signal }), signal);
    },
    refresh(credential, requested) {
      const signal = bounded(requested); signal.throwIfAborted();
      return waitForNative(oauth.refresh(credential, signal), signal);
    },
  };
  return {
    id: "codebuddy-cn" as const,
    auth,
    getCatalog(credential: NativeOAuthCredential, accountKey?: string) { return catalog.get(credential.access, accountKey); },
    catalog(credential: NativeOAuthCredential, requested: AbortSignal, accountKey?: string) {
      const signal = bounded(requested); signal.throwIfAborted();
      return catalog.refresh(credential.access, signal, accountKey);
    },
    stream: client.stream,
    dispose() { lifetime.abort(); catalog.dispose(); client.dispose(); },
  };
}
