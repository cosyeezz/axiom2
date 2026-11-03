# Current public KAS static evidence

## Conclusion
Body-only AWS JSON 1.0 is supported by this actual selected serializer, despite REST/query traits in the operation schema. KIRO_CLI is in the control-plane Origin enum. The new existing diagnosis strengthens a profile/ARN-validation hypothesis, but cannot identify the exact failed ARN or validation rule. No new request was made.

## Identity and preservation
Source path, freshly computed full SHA256/size, and byte ranges are in index.json. public-package.json independently confirms package name/version and the kiro-agent bin entry. Public @kiro/agent 0.66.70 bundle: 15,025,207 bytes; SHA256 bf79b2b0fa7ae68653abdf117b4a4dbf064fec6fa7ca49500115f3f2f67581b1. This path exists; an older missing temp path does not imply the public source is unavailable. These are raw bounded public-code slices, sometimes starting/ending mid-expression, not executable fixtures. Full bundle was streamed only for identity hashing; symbol location used exact literal searches, not full-package analysis.

## Serializer / schema
- client-protocol-default.txt: default protocol AwsJson1_0Protocol, target KiroControlPlaneBearerService.
- json-rpc-protocol.txt: MY extends x0; adds Content-Type application/x-amz-json-1.0 and x-amz-target. rpc-base.txt: POST, base path '/', whole input serialized into body, empty query. Thus REST GET/httpQuery traits do not establish the active wire representation.
- schema-names.txt + catalog-schema.txt: origin string, maxResults numeric, nextToken string, profileArn string, modelProvider string. catalog-operation.txt preserves GET /List-Available-Models trait, explicitly not proof active RPC uses GET.
- origin-enum.txt: AI_EDITOR, CLI, IDE, KIRO_CLI, KIRO_CONSOLE, KIRO_WEB, MD_IDE, SM_AI_STUDIO_IDE.

## Auth / profile / TokenType
identity-resolver.txt: $l calls resolveIdentity if supplied, else awaits getToken then getProfileArn; catalog-caller.txt awaits $l before making directory request and calls Cy(client,identity.authMethod). default-auth-profile.txt: default NMe resolves token.profileArn or locally stored profile JSON arn, not remote discovery in this local chain. Do not read those storage files. There is no unconditional enterprise-profile discovery or mandatory-profile gate in the shown directory chain; server enterprise prerequisites remain unknown.

token-type-map.txt + token-type-middleware.txt: IdC -> SSO_OIDC; external_idp -> EXTERNAL_IDP; machine_token -> KIRO_MACHINE_TOKEN; api_key -> API_KEY. Cy writes TokenType in build middleware; unknown method omits it. bff-token-type.txt independently maps IdC to SSO_OIDC for BFF identity.

Axiom correspondence: axiom-auth-entry.txt records identity-center UI labelled IAM Identity Center, requests organization Start URL/region, then AWS OIDC /client/register and /token (PKCE or device), retaining authMethod identity-center. axiom-auth-definitions.txt defines oidcOrigin and metadata; axiom-auth-refresh.txt refreshes non-social through AWS oidc /token with clientId/clientSecret/refreshToken. Official idc-refresh.txt routes authMethod IdC to Lhd, which uses SSOOIDCClient/CreateTokenCommand with region, clientId/clientSecret/refreshToken, grantType refresh_token. This supports identity-center -> IdC/SSO_OIDC by auth-family semantics, not identical literal enum or full registration parity. Builder-id also uses Axiom's AWS OIDC entry, so do not infer all OIDC tokens are enterprise-only; exact official login labels are outside preserved KAS entry.

## Existing failure interpretation
../diagnose-validation.json: one request, HTTP400; profile=true, arn=true, invalid=true, type=true; origin/token/required/missing/SSO_OIDC/KIRO_CLI=false. These are independent term-presence predicates, not the raw message or parsed field path. Stronger evidence to prioritize profile ARN validation; it does not prove missing profile is accepted/rejected, a supplied ARN is malformed, the failing field is in body versus token context, or TokenType fixes the error. ../diagnose-400.json says ValidationException and profileRequired=false; that predicate does not exclude other profile validation errors. No raw response, credentials, authstore, environment, or CLI storage was copied.

## Execution boundary
CWD /Volumes/D_Work/axiom2. Tool read calls examined public project auth source and existing sanitized diagnostic JSON. python3 heredocs performed bounded source reads/literal location, then streaming hashlib.sha256 + Path.mkdir/write_bytes/write_text for these NEW evidence files; all completed exit 0. No network, CLI execution/import, tests/builds, production/test/config modification, or credential reads. No tests claimed passed. No runtime parity claim.
