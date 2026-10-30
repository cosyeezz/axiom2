import assert from "node:assert/strict";
import { test } from "node:test";
import { createModels, InMemoryCredentialStore, type Credential, type AuthPrompt } from "@earendil-works/pi-ai";
import { accountInfo, kiroLoginPrompt, loginPromptDefault, type KiroLoginField } from "../src/server/model-account-info.js";
import { kiroOAuth } from "../src/server/providers/kiro-auth.js";
import { usageMetricPercent } from "../src/shared/model-account-usage.js";

const base = (): Credential => ({ type: "oauth", access: "PRIVATE_ACCESS", refresh: "PRIVATE_REFRESH", expires: Date.now() + 3600000 });

test("account information is a bounded display projection, never a credential dump", () => {
  const credential = { ...base(), email: "person@example.test", accountId: "account-123", clientSecret: "PRIVATE_CLIENT", env: { email: "not-this@example.test" } } as Credential;
  assert.deepEqual(accountInfo("openai-codex", credential), { email: "person@example.test", accountId: "account-123" });
  assert.deepEqual(accountInfo("anthropic", { ...base(), accountId: "unexpected" } as Credential), {});
  assert.deepEqual(accountInfo("kiro", { ...base(), email: "bad\n@example.test", authRegion: "us-east-1.evil.test", authMethod: "PRIVATE_ACCESS", authFlow: "unknown", startUrl: "https://org.awsapps.com/start?token=PRIVATE_ACCESS" } as Credential), { login: {} });
  assert.deepEqual(accountInfo("openai", { type: "api_key", key: "PRIVATE_KEY" }), {});
  const claims = Buffer.from(JSON.stringify({ email: "unverified@example.test" })).toString("base64url");
  assert.deepEqual(accountInfo("openai", { ...base(), access: `header.${claims}.signature` } as Credential), { email: "unverified@example.test", emailSource: "token" });
  assert.deepEqual(accountInfo("anthropic", { ...base(), access: `header.${claims}.signature` } as Credential), {});
  assert.ok(!JSON.stringify(accountInfo("kiro", credential)).includes("PRIVATE"));
});

test("Codex display metadata follows Sub2API claim sources with bounds and explicit-field precedence", () => {
  const token = (raw: unknown) => `header.${Buffer.from(JSON.stringify(raw)).toString("base64url")}.signature`;
  const credential = { ...base(), access: token({ email: "codex@example.test", "https://api.openai.com/auth": { chatgpt_account_id: "account-codex", chatgpt_plan_type: "plus" }, private: "PRIVATE_RAW" }) } as Credential;
  assert.deepEqual(accountInfo("openai-codex", credential), { email: "codex@example.test", emailSource: "token", accountId: "account-codex", plan: "plus" });
  assert.equal(accountInfo("openai-codex", { ...credential, email: "saved@example.test" } as Credential).email, "saved@example.test");
  assert.equal(accountInfo("openai-codex", { ...credential, id_token: token({ email: "id@example.test" }) } as Credential).email, "id@example.test");
  for (const access of ["opaque", "header.!!!.signature", "x".repeat(32769), token({ email: "bad\n@example.test", "https://api.openai.com/auth": { chatgpt_account_id: "<script>", chatgpt_plan_type: "x".repeat(65) } })]) {
    assert.deepEqual(accountInfo("openai-codex", { ...base(), access } as Credential), {});
  }
  assert.ok(!JSON.stringify(accountInfo("openai-codex", credential)).includes("PRIVATE"));
});

test("saved Kiro choices prefill only app-owned non-secret prompts and remain editable", () => {
  const credential = { ...base(), authMethod: "identity-center", authRegion: "eu-west-1", authFlow: "device", startUrl: "https://org.awsapps.com/start" } as Credential;
  for (const field of ["startUrl", "authRegion"] as const) {
    const prompt = kiroLoginPrompt(field, { type: "text", message: field });
    assert.equal(loginPromptDefault("kiro", prompt, credential), field === "startUrl" ? "https://org.awsapps.com/start" : "eu-west-1");
  }
  const select = kiroLoginPrompt("method", { type: "select", message: "method", options: [{ id: "identity-center", label: "企业" }] });
  assert.equal(loginPromptDefault("kiro", select, credential), "identity-center");
  assert.equal(loginPromptDefault("anthropic", select, credential), undefined);
  assert.equal(loginPromptDefault("kiro", { type: "text", message: "authRegion" }, credential), undefined);
  assert.equal(loginPromptDefault("kiro", kiroLoginPrompt("startUrl", { type: "secret", message: "secret" }), credential), undefined);
  assert.equal(loginPromptDefault("kiro", kiroLoginPrompt("startUrl", { type: "manual_code", message: "code" }), credential), undefined);
  assert.equal(loginPromptDefault("kiro", kiroLoginPrompt("method", { type: "select", message: "method", options: [{ id: "social", label: "个人" }] }), credential), undefined);
  // The only extra wire field is the stable preference key, not any stored secret.
  assert.ok(!JSON.stringify(select).includes("PRIVATE"));
});

test("Kiro successful login persists enterprise URL, region and flow; rotation retains all choices", async () => {
  for (const flow of ["pkce", "device"] as const) {
    const oauth = kiroOAuth({ wait: async () => {}, callback: async () => ({ origin: "http://127.0.0.1:44991", wait: async () => ({ code: "FIXTURE_CODE", redirectUri: "http://127.0.0.1:44991/oauth/callback" }), close: async () => {} }),
      fetch: async input => {
        const url = new URL(String(input));
        assert.equal(url.hostname, "oidc.eu-west-1.amazonaws.com");
        const data = url.pathname === "/client/register" ? { clientId: "FIXTURE_CLIENT", clientSecret: "PRIVATE_CLIENT", clientSecretExpiresAt: Math.floor(Date.now() / 1000) + 86400 }
          : url.pathname === "/device_authorization" ? { deviceCode: "PRIVATE_DEVICE", userCode: "USER", verificationUri: "https://device.example.test/", interval: 1, expiresIn: 600 }
          : { accessToken: "PRIVATE_NEW_ACCESS", refreshToken: "PRIVATE_NEW_REFRESH", expiresIn: 3600 };
        return new Response(JSON.stringify(data), { headers: { "Content-Type": "application/json" } });
      },
    });
    const credentials = new InMemoryCredentialStore(), runtime = createModels({ credentials });
    runtime.setProvider({ id: "kiro", name: "Kiro", getModels: () => [], auth: { oauth },
      stream: () => { throw Error("Login-only fixture must not stream"); },
      streamSimple: () => { throw Error("Login-only fixture must not stream"); },
    });
    const answers: Record<KiroLoginField, string> = { method: "identity-center", startUrl: "https://org.awsapps.com/start", authRegion: "eu-west-1", flow };
    const prompts: AuthPrompt[] = [];
    await runtime.login("kiro", "oauth", { notify: () => {}, prompt: async prompt => {
      prompts.push(prompt);
      const field = (prompt as AuthPrompt & { kiroLoginField: KiroLoginField }).kiroLoginField;
      assert.ok(field in answers); return answers[field];
    } });
    const stored = await credentials.read("kiro");
    assert.ok(stored?.type === "oauth");
    const login = { method: "identity-center", startUrl: "https://org.awsapps.com/start", authRegion: "eu-west-1", flow };
    assert.deepEqual(accountInfo("kiro", stored).login, login);
    const refreshed = await oauth.refresh(stored, new AbortController().signal);
    assert.deepEqual(accountInfo("kiro", refreshed).login, login);
    for (const prompt of prompts) {
      const field = (prompt as AuthPrompt & { kiroLoginField: KiroLoginField }).kiroLoginField;
      assert.equal(loginPromptDefault("kiro", prompt, stored), answers[field]);
    }
    assert.ok(!JSON.stringify(accountInfo("kiro", refreshed)).includes("PRIVATE"));
  }
});

test("official progress uses only known ratios, clamps windows and does not invent balances", () => {
  assert.equal(usageMetricPercent({ id: "w", label: "window", kind: "window", usedPercent: 37.5 }), 37.5);
  assert.equal(usageMetricPercent({ id: "w", label: "window", kind: "window", usedPercent: 150 }), 100);
  assert.equal(usageMetricPercent({ id: "w", label: "window", kind: "window", usedPercent: null }), undefined);
  assert.equal(usageMetricPercent({ id: "w", label: "window", kind: "window", usedPercent: NaN }), undefined);
  assert.equal(usageMetricPercent({ id: "t", label: "tokens", kind: "tokens", model: "m", used: 25, remaining: 75 }), 25);
  assert.equal(usageMetricPercent({ id: "t", label: "tokens", kind: "tokens", model: "m", used: null, remaining: 75 }), undefined);
  assert.equal(usageMetricPercent({ id: "b", label: "balance", kind: "balance", balance: "100" }), undefined);
  assert.equal(usageMetricPercent({ id: "c", label: "count", kind: "count", count: 10 }), undefined);
});
