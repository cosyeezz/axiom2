import type { OAuthAuth } from "@earendil-works/pi-ai";
import { createKiroOAuth } from "../../native-providers/kiro/auth.js";
import { kiroLoginPrompt, type KiroLoginField } from "../model-account-info.js";
import { kiroCallback } from "./kiro-callback.js";
export type { KiroCredential } from "../../native-providers/kiro/auth.js";

/** Pi owns the credential lock and persistence; the component owns OAuth protocol. */
export function kiroOAuth(options: Parameters<typeof createKiroOAuth>[0] = {}): OAuthAuth {
  const oauth = createKiroOAuth({ ...options, callback: options.callback ?? kiroCallback });
  return {
    name: "Kiro（仅认证）", loginLabel: "登录 Kiro 个人或组织账号",
    login(interaction) {
      return oauth.login({ signal: interaction.signal, notify: event => interaction.notify(event), prompt: prompt => {
        const { field, ...body } = prompt;
        return interaction.prompt(field && ["method", "startUrl", "authRegion", "flow"].includes(field)
          ? kiroLoginPrompt(field as KiroLoginField, body) : body);
      } });
    },
    refresh: oauth.refresh,
    // Only the Pi native chat adapter issues the one-use in-process auth capability.
    async toAuth() { throw new Error("Kiro 账号令牌仅供原生适配器使用，不能派生为通用或自定义接口密钥。"); },
  };
}
