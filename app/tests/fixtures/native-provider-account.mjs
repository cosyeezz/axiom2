import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import http from "node:http";
import https from "node:https";
import net from "node:net";
let network = 0;
const forbidden = () => { network++; throw Error("Network forbidden in standalone OAuth fixture"); };
globalThis.fetch = forbidden;
http.request = https.request = net.Socket.prototype.connect = forbidden;
const { createKiroOAuth, createNativeAccount } = await import(pathToFileURL(process.argv[2]).href);
let requests = 0, notices = 0, stored, revision = 0;
const prompts = [];
const transport = async (url, init) => {
  requests++;
  assert.equal(new URL(url).origin, "https://oidc.us-east-1.amazonaws.com");
  assert.equal(init.redirect, "error");
  const body = JSON.parse(init.body);
  let response;
  if (url.endsWith("/client/register")) {
    assert.equal(body.clientName, "OAuth Client"); assert.deepEqual(body.grantTypes, ["urn:ietf:params:oauth:grant-type:device_code", "refresh_token"]);
    response = { clientId: "SYNTHETIC-ID", clientSecret: "SYNTHETIC-SECRET", clientSecretExpiresAt: Math.floor(Date.now() / 1000) + 3600 };
  } else if (url.endsWith("/device_authorization")) {
    response = { deviceCode: "SYNTHETIC-DEVICE", userCode: "SYNTHETIC-CODE", verificationUri: "https://fixture.invalid/authorize", expiresIn: 60, interval: 1 };
  } else {
    assert.ok(url.endsWith("/token"));
    if (body.grantType === "refresh_token") assert.equal(body.refreshToken, "SYNTHETIC-REFRESH");
    else assert.equal(body.grantType, "urn:ietf:params:oauth:grant-type:device_code");
    response = { accessToken: "SYNTHETIC-ACCESS", refreshToken: body.grantType === "refresh_token" ? "SYNTHETIC-ROTATED" : "SYNTHETIC-REFRESH", expiresIn: 60 };
  }
  return Response.json(response);
};
const oauth = createKiroOAuth({ fetch: transport, wait: async () => {}, requestTimeoutMs: 1000 });
let queue = Promise.resolve();
const snapshot = () => structuredClone({ revision: String(revision), credential: stored });
const store = {
  async read(signal) { signal.throwIfAborted(); return snapshot(); },
  transaction(update, signal) {
    const work = queue.then(async () => {
      signal.throwIfAborted(); const next = await update(snapshot()); signal.throwIfAborted();
      if (next !== undefined) { stored = next === null ? undefined : structuredClone(next); revision++; }
      return snapshot();
    });
    queue = work.then(() => {}, () => {}); return work;
  },
};
const account = createNativeAccount(oauth, store), signal = AbortSignal.timeout(5000);
const loggedIn = await account.login({ signal, prompt: async prompt => {
  prompts.push(prompt.field);
  return prompt.field === "method" ? "builder-id" : "device";
}, notify: notice => { assert.equal(notice.type, "device_code"); notices++; } });
assert.equal(loggedIn.authMethod, "builder-id");
await store.transaction(async current => ({ ...current.credential, expires: 0 }), signal);
const current = await account.resolve(signal);
assert.equal(current.refresh, "SYNTHETIC-ROTATED");
account.dispose();
console.log(JSON.stringify({ login: true, refresh: true, prompts, deviceNotices: notices, requests, network }));
