// Explicit CN CLI compatibility profile; runtime wire parity is verified separately.
export const codeBuddyId = "codebuddy-cn";
export const codeBuddyOrigin = "https://copilot.tencent.com";
export const codeBuddyBaseUrl = `${codeBuddyOrigin}/v2`;
// CLI ClientInfoProvider -> PackageUtils -> embedded package 30780.T, verified for 2.179.0.
// Default profile only: no product/env overrides, preexisting UA or userAgentExtension.
export const codeBuddyCliVersion = "2.179.0";
export const codeBuddyHeaders = Object.freeze({
  "User-Agent": `CLI/${codeBuddyCliVersion} CodeBuddy/${codeBuddyCliVersion}`,
  "X-Product": "SaaS", "X-IDE-Type": "CLI", "X-IDE-Name": "CLI", "X-IDE-Version": codeBuddyCliVersion,
  "x-requested-with": "XMLHttpRequest", "x-codebuddy-request": "1",
});
