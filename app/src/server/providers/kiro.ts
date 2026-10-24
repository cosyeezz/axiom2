import type { Provider } from "@earendil-works/pi-ai";
import { kiroOAuth } from "./kiro-auth.js";

/** Auth-only integration: Kiro's inference wire protocol is not OpenAI compatible. */
export function kiroProvider(): Provider {
  const unsupported = (): never => { throw new Error("Kiro 当前仅接入账号认证，尚未实现模型推理协议。"); };
  return {
    id: "kiro", name: "kiro", auth: { oauth: kiroOAuth() },
    getModels: () => [], stream: unsupported, streamSimple: unsupported,
  };
}
