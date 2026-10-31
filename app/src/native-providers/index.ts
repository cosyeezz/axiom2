/** SDK-independent in-process native providers. Host adapters are deliberately not exported. */
export type * from "./contracts.js";
export { createNativeAccount } from "./account.js";
export { createCodeBuddyNativeProvider } from "./codebuddy/provider.js";
export { createCodeBuddyOAuth, type CodeBuddyOAuthOptions } from "./codebuddy/auth.js";
export { createCodeBuddyClient, type CodeBuddyStreamInput } from "./codebuddy/client.js";
export { createCodeBuddyCatalog, fetchCodeBuddyCatalog, type CodeBuddyCatalogSnapshot } from "./codebuddy/catalog.js";
export { codeBuddyBuiltinModels, parseCodeBuddyConfiguration } from "./codebuddy/models.js";
export { codeBuddyId, codeBuddyOrigin, codeBuddyBaseUrl, codeBuddyCliVersion, codeBuddyHeaders } from "./codebuddy/identity.js";
export { codeBuddyNativeFetch, codeBuddyNativeHttp } from "./codebuddy/http.js";
export { prepareCodeBuddyRequest, type CodeBuddyStreamOptions, type CodeBuddyIdentity } from "./codebuddy/request.js";
export { CodeBuddyProtocolError, CodeBuddyServiceError, codeBuddyFailure } from "./codebuddy/failure.js";
