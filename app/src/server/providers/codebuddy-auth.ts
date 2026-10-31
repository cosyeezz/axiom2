import type { OAuthAuth } from "@earendil-works/pi-ai";
import { createCodeBuddyOAuth, type CodeBuddyOAuthOptions } from "../../native-providers/codebuddy/auth.js";

/** Pi owns credential locking/persistence; the independent component owns the CN OAuth protocol. */
export function codeBuddyOAuth(options: CodeBuddyOAuthOptions = {}): OAuthAuth {
  const oauth = createCodeBuddyOAuth(options);
  return {
    name: "CodeBuddy 国内版", loginLabel: "登录 CodeBuddy 国内版",
    login(interaction) {
      return oauth.login({ signal: interaction.signal, notify: event => interaction.notify(event), prompt: prompt => {
        const { field: _field, ...body } = prompt;
        return interaction.prompt(body);
      } });
    },
    refresh: oauth.refresh,
    async toAuth(credential) { return { apiKey: credential.access }; },
  };
}
