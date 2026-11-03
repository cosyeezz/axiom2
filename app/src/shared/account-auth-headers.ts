/** A literal credential reference, never an environment variable or executable expression. */
export const accountKeyReference = "{{account.key}}";
export const isAccountKeyReference = (value: unknown): value is string =>
  value === accountKeyReference || value === `Bearer ${accountKeyReference}`;
const names = new Set(["authorization", "proxy-authorization", "x-api-key", "api-key", "x-goog-api-key", "x-auth-token", "x-access-token", "cookie", "chatgpt-account-id"]);
export const isAuthenticationHeader = (name: string) => names.has(name.toLowerCase());
