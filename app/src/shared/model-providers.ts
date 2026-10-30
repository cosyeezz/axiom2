/**
 * Axiom's default OpenAI subscription connection intentionally uses Pi's Codex
 * OAuth/provider, not the separate OpenAI direct grant. Keep its native ID for
 * credentials, model selection and accounting; only the presentation is OpenAI.
 * Never copy direct/API-key credentials into this provider.
 */
export const openAIProviderId = "openai-codex";
export const providerDisplayName = (providerId: string) =>
  providerId === openAIProviderId || providerId === "openai" ? "OpenAI" : providerId;
