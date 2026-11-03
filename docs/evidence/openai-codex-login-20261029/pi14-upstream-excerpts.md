# Numbered excerpts (unaltered source lines)
TypeScript files are source text recovered verbatim from npm-shipped .js.map sourcesContent, not fetched from a mutable branch. Corresponding compiled JS remains in extracted npm package.

## /private/tmp/axiom-pi14-ws/upstream/sourcemap-sources/openai.ts
```text
9: export function openaiProvider(): Provider<"openai-responses"> {
10: 	return createProvider<"openai-responses">({
11: 		id: "openai",
12: 		name: "OpenAI",
13: 		baseUrl: "https://api.openai.com/v1",
14: 		auth: {
15: 			apiKey: envApiKeyAuth("OpenAI API key", ["OPENAI_API_KEY"]),
16: 			oauth: lazyOAuth({
17: 				name: "OpenAI (ChatGPT subscription)",
18: 				isSubscription: true,
19: 				loginLabel: "Sign in with ChatGPT",
20: 				load: loadOpenAIChatGPTOAuth,
21: 			}),
22: 		},
23: 		models: [
24: 			...Object.values(OPENAI_MODELS),
25: 			...Object.values<ClassifierModel<"openai-decisions">>(OPENAI_CLASSIFIER_MODELS),
26: 		],
27: 		// Sign in with ChatGPT tokens only reach the Responses API; the Decisions API rejects them.
28: 		filterAllModels: (models, credential) =>
29: 			credential?.type === "oauth" ? models.filter((model) => !isModelType(model, "classifier")) : models,
30: 		api: openAIResponsesApi(),
31: 		classifiers: {
32: 			"openai-decisions": openAIDecisionsApi(),
33: 		},
34: 	});
35: }
```

## /private/tmp/axiom-pi14-ws/upstream/sourcemap-sources/openai-codex.ts
```text
1: import { openAICodexResponsesApi } from "../api/openai-codex-responses.lazy.ts";
2: import { lazyOAuth } from "../auth/helpers.ts";
3: import { loadOpenAICodexOAuth } from "../auth/oauth/load.ts";
4: import { createProvider, type Provider } from "../models.ts";
5: import { OPENAI_CODEX_MODELS } from "./openai-codex.models.ts";
6: 
7: export function openaiCodexProvider(): Provider<"openai-codex-responses"> {
8: 	return createProvider({
9: 		id: "openai-codex",
10: 		name: "OpenAI Codex (legacy)",
11: 		baseUrl: "https://chatgpt.com/backend-api",
12: 		auth: {
13: 			oauth: lazyOAuth({
14: 				name: "OpenAI (ChatGPT Plus/Pro)",
15: 				isSubscription: true,
16: 				load: loadOpenAICodexOAuth,
17: 			}),
18: 		},
19: 		models: Object.values(OPENAI_CODEX_MODELS),
20: 		api: openAICodexResponsesApi(),
21: 	});
22: }
```

## /private/tmp/axiom-pi14-ws/upstream/sourcemap-sources/openai-responses.ts
```text
44: 
45: /**
46:  * OpenAI API keys start with `sk-`; a different credential sent directly to OpenAI
47:  * is a Sign in with ChatGPT access token.
48:  */
49: function isChatGPTSignIn(model: Model<"openai-responses">, apiKey: string | undefined): boolean {
50: 	return (
51: 		model.provider === "openai" &&
52: 		model.baseUrl === "https://api.openai.com/v1" &&
53: 		apiKey !== undefined &&
54: 		!apiKey.startsWith("sk-")
55: 	);
56: }
```
```text
180: 			},
181: 			stopReason: "pending",
182: 			timestamp: Date.now(),
183: 		};
184: 
185: 		try {
186: 			// Create OpenAI client
187: 			const apiKey = getClientApiKey(model.provider, options?.apiKey, options?.headers);
188: 			const cacheRetention = resolveCacheRetention(options?.cacheRetention, options?.env);
189: 			const cacheSessionId = cacheRetention === "none" ? undefined : options?.sessionId;
190: 			const grammarToolInputProperties = createGrammarToolInputProperties(
191: 				getDeclaredTools(normalizedContext.messages),
192: 				compat.supportsOpenAIGrammarTools,
193: 			);
194: 			const client = createClient(
195: 				model,
196: 				normalizedContext,
197: 				apiKey,
198: 				options?.headers,
199: 				options?.identity,
200: 				options?.fetch,
201: 				cacheSessionId,
202: 			);
203: 			let params = buildParams(
204: 				model,
205: 				normalizedContext,
206: 				options,
207: 				compat,
208: 				grammarToolInputProperties,
209: 				configurationUpdateEffort,
210: 			);
211: 			const nextParams = await options?.onPayload?.(params, model);
212: 			if (nextParams !== undefined) {
213: 				params = nextParams as ResponseCreateParamsStreaming;
214: 			}
215: 			const requestOptions = {
216: 				...(options?.signal ? { signal: options.signal } : {}),
217: 				...(options?.timeoutMs !== undefined ? { timeout: options.timeoutMs } : {}),
218: 				maxRetries: 0,
219: 			};
220: 			const { data: openaiStream, response } = await retryProviderRequest(
221: 				() => client.responses.create(params, requestOptions).withResponse(),
222: 				{
223: 					maxRetries: options?.maxRetries,
224: 					maxRetryDelayMs: options?.maxRetryDelayMs,
225: 					signal: options?.signal,
226: 				},
227: 			);
228: 			await options?.onResponse?.({ status: response.status, headers: headersToRecord(response.headers) }, model);
229: 			stream.push({ type: "start", partial: output });
230: 
231: 			await processResponsesStream(openaiStream, output, stream, model, {
232: 				onProviderStreamEvent: options?.onProviderStreamEvent,
233: 				serviceTier: options?.serviceTier,
234: 				grammarToolInputProperties,
235: 				applyServiceTierPricing: (usage, serviceTier) => applyServiceTierPricing(usage, serviceTier, model),
236: 			});
237: 
238: 			if (options?.signal?.aborted) {
239: 				throw new Error("Request was aborted");
240: 			}
```
```text
315: 			hasImages,
316: 		});
317: 		Object.assign(headers, copilotHeaders);
318: 	}
319: 
320: 	if (sessionId) {
321: 		if (compat.sessionAffinityFormat === "openrouter") {
322: 			headers["x-session-id"] = sessionId;
323: 		} else {
324: 			if (compat.sessionAffinityFormat === "openai") {
325: 				headers.session_id = sessionId;
326: 			}
327: 			headers["x-client-request-id"] = sessionId;
328: 		}
329: 	}
330: 
331: 	// Merge options headers last so they can override defaults
332: 	if (optionsHeaders) {
333: 		Object.assign(headers, optionsHeaders);
334: 	}
335: 
336: 	return new OpenAI({
337: 		apiKey,
338: 		baseURL: model.baseUrl,
339: 		dangerouslyAllowBrowser: true,
340: 		fetch,
341: 		defaultHeaders: headers,
342: 	});
343: }
344: 
345: function buildParams(
346: 	model: Model<"openai-responses">,
347: 	context: TranscriptContext,
348: 	options: OpenAIResponsesOptions | undefined,
349: 	compat: Required<OpenAIResponsesCompat>,
350: 	grammarToolInputProperties: ReadonlyMap<string, string>,
351: 	configurationUpdateEffort: string | undefined,
352: ) {
353: 	const transcriptTools = resolveTranscriptTools(context.messages, getResponsesToolSupport(compat));
354: 	const messages = convertResponsesMessages(model, context, OPENAI_TOOL_CALL_PROVIDERS, {
355: 		grammarToolInputProperties,
356: 		supportsMidConvoSystemMessages: compat.supportsMidConvoSystemMessages,
357: 		supportsAdditionalTools: compat.supportsAdditionalTools,
358: 		supportsToolSearch: compat.supportsToolSearch,
359: 		toolOptions: {
360: 			supportsStrictMode: compat.supportsStrictMode,
361: 			supportsOpenAIGrammarTools: compat.supportsOpenAIGrammarTools,
362: 		},
363: 		configurationUpdateEffort,
364: 	});
365: 
366: 	const cacheRetention = resolveCacheRetention(options?.cacheRetention, options?.env);
367: 	// Sign in with ChatGPT rejects these request fields.
368: 	const omitUnsupportedFields = isChatGPTSignIn(model, options?.apiKey);
369: 	const params: ResponseCreateParamsStreaming = {
370: 		model: model.id,
371: 		input: messages,
372: 		stream: true,
373: 		prompt_cache_key: cacheRetention === "none" ? undefined : clampOpenAIPromptCacheKey(options?.sessionId),
374: 		prompt_cache_retention: omitUnsupportedFields ? undefined : getPromptCacheRetention(compat, cacheRetention),
375: 		prompt_cache_options: omitUnsupportedFields ? undefined : getPromptCacheOptions(compat, cacheRetention),
376: 		store: false,
377: 	};
378: 
379: 	if (options?.maxTokens && compat.supportsMaxOutputTokens && !omitUnsupportedFields) {
380: 		params.max_output_tokens = Math.max(options.maxTokens, OPENAI_RESPONSES_MIN_OUTPUT_TOKENS);
381: 	}
382: 
383: 	if (options?.temperature !== undefined && !omitUnsupportedFields) {
384: 		params.temperature = options?.temperature;
385: 	}
386: 
387: 	if (options?.serviceTier !== undefined) {
388: 		params.service_tier = options.serviceTier;
389: 	}
390: 
391: 	if (transcriptTools.requestTools.length > 0) {
392: 		params.tools = convertResponsesTools(transcriptTools.requestTools, {
393: 			supportsStrictMode: compat.supportsStrictMode,
394: 			supportsOpenAIGrammarTools: compat.supportsOpenAIGrammarTools,
395: 		});
396: 	}
397: 
398: 	if (options?.toolChoice !== undefined) {
399: 		params.tool_choice = options.toolChoice;
400: 	}
401: 
402: 	const reasoningEffort = options?.reasoningEffort ?? (options?.reasoningSummary ? "medium" : undefined);
```

## /private/tmp/axiom-pi14-ws/upstream/sourcemap-sources/openai-codex-responses.ts
```text
54: // ============================================================================
55: 
56: const DEFAULT_CODEX_BASE_URL = "https://chatgpt.com/backend-api";
57: const JWT_CLAIM_PATH = "https://api.openai.com/auth" as const;
58: const DEFAULT_MAX_RETRIES = 0;
59: const BASE_DELAY_MS = 1000;
60: const DEFAULT_MAX_RETRY_DELAY_MS = 60_000;
61: const DEFAULT_WEBSOCKET_CONNECT_TIMEOUT_MS = 15_000;
62: // The Codex backend accepts zstd-compressed request bodies on the SSE responses
63: // endpoint (the same endpoint the official Codex client compresses against).
```
```text
267: 		};
268: 
269: 		try {
270: 			const apiKey = options?.apiKey;
271: 			if (!apiKey) {
272: 				throw new Error(`No API key for provider: ${model.provider}`);
273: 			}
274: 
275: 			const accountId = extractAccountId(apiKey);
276: 			const grammarToolInputProperties = createGrammarToolInputProperties(
277: 				getDeclaredTools(normalizedContext.messages),
278: 				model.compat?.supportsOpenAIGrammarTools ?? false,
279: 			);
280: 			const cacheSessionId = options?.cacheRetention === "none" ? undefined : options?.sessionId;
281: 			const codexSessionId = clampOpenAIPromptCacheKey(cacheSessionId);
282: 			let body = buildRequestBody(model, normalizedContext, options, codexSessionId, grammarToolInputProperties);
283: 			const nextBody = await options?.onPayload?.(body, model);
284: 			if (nextBody !== undefined) {
285: 				body = nextBody as RequestBody;
286: 			}
```
```text
306: 			const bodyJson = JSON.stringify(body);
307: 			const httpTimeoutMs = normalizeTimeoutMs(options?.timeoutMs);
308: 			const websocketConnectTimeoutMs = normalizeTimeoutMs(options?.websocketConnectTimeoutMs);
309: 			const transport = options?.transport || "auto";
310: 			let startEmitted = false;
311: 			const websocketDisabledForSession = transport !== "sse" && isWebSocketSseFallbackActive(cacheSessionId);
312: 			if (websocketDisabledForSession) {
313: 				recordWebSocketSseFallback(cacheSessionId);
314: 			}
315: 
316: 			if (transport !== "sse" && !websocketDisabledForSession) {
317: 				let websocketStarted = false;
318: 				let retriedWebSocketConnectionLimit = false;
319: 				let retriedMissingWebSocketContinuation = false;
320: 				while (true) {
321: 					websocketStarted = false;
322: 					try {
323: 						await processWebSocketStream(
324: 							resolveCodexWebSocketUrl(model.baseUrl),
325: 							body,
326: 							websocketHeaders,
327: 							output,
328: 							stream,
329: 							model,
330: 							() => {
331: 								websocketStarted = true;
332: 								if (!startEmitted) {
333: 									startEmitted = true;
334: 									stream.push({ type: "start", partial: output });
335: 								}
336: 							},
337: 							httpTimeoutMs,
338: 							websocketConnectTimeoutMs,
339: 							cacheSessionId,
340: 							accountId,
341: 							grammarToolInputProperties,
342: 							options,
343: 						);
344: 
345: 						if (options?.signal?.aborted) {
346: 							throw new Error("Request was aborted");
347: 						}
348: 						assertSuccessfulOutput(output);
349: 						stream.push({
350: 							type: "done",
351: 							reason: output.stopReason,
352: 							message: output,
353: 						});
354: 						stream.end();
355: 						return;
356: 					} catch (error) {
357: 						const aborted = options?.signal?.aborted;
358: 						const connectionLimitBeforeStart = !websocketStarted && isWebSocketConnectionLimitReachedError(error);
359: 						const previousResponseNotFound = isPreviousResponseNotFoundError(error);
360: 						if (!aborted && previousResponseNotFound && !retriedMissingWebSocketContinuation) {
361: 							retriedMissingWebSocketContinuation = true;
362: 							continue;
363: 						}
364: 						if (!aborted && connectionLimitBeforeStart && !retriedWebSocketConnectionLimit) {
365: 							retriedWebSocketConnectionLimit = true;
366: 							continue;
367: 						}
368: 						if (aborted || (isCodexNonTransportError(error) && !connectionLimitBeforeStart)) {
369: 							throw error;
370: 						}
371: 						appendAssistantMessageDiagnostic(
372: 							output,
373: 							createAssistantMessageDiagnostic("provider_transport_failure", error, {
374: 								configuredTransport: transport,
375: 								...(websocketStarted ? {} : { fallbackTransport: "sse" }),
376: 								eventsEmitted: websocketStarted,
377: 								phase: websocketStarted ? "after_message_stream_start" : "before_message_stream_start",
378: 								requestBytes: new TextEncoder().encode(bodyJson).byteLength,
379: 							}),
380: 						);
381: 						recordWebSocketFailure(cacheSessionId, error);
382: 						if (websocketStarted) {
383: 							throw error;
384: 						}
385: 						recordWebSocketSseFallback(cacheSessionId);
386: 						break;
387: 					}
388: 				}
389: 			}
390: 
391: 			// Compress the request body once for the SSE path. The Codex backend
392: 			// decodes Content-Encoding: zstd; the WebSocket transport above sends the
393: 			// uncompressed JSON frame, matching the official Codex client.
394: 			const compressedBody = compressRequestBodyZstd(bodyJson);
395: 			if (compressedBody) {
396: 				sseHeaders.set("content-encoding", "zstd");
397: 			}
398: 			const sseBody: Uint8Array<ArrayBuffer> | string = compressedBody ?? bodyJson;
```
```text
884: // WebSocket Parsing
885: // ============================================================================
886: 
887: const OPENAI_BETA_RESPONSES_WEBSOCKETS = "responses_websockets=2026-02-06";
888: const SESSION_WEBSOCKET_CACHE_TTL_MS = 5 * 60 * 1000;
889: const SESSION_WEBSOCKET_MAX_AGE_MS = 55 * 60 * 1000;
890: 
891: type WebSocketEventType = "open" | "message" | "error" | "close";
892: type WebSocketListener = (event: unknown) => void;
893: 
894: interface WebSocketLike {
895: 	close(code?: number, reason?: string): void;
```
```text
960: 
961: export function resetOpenAICodexWebSocketDebugStats(sessionId?: string): void {
962: 	if (sessionId) {
963: 		websocketDebugStats.delete(sessionId);
964: 		websocketSseFallbackSessions.delete(sessionId);
965: 		return;
966: 	}
967: 	websocketDebugStats.clear();
968: 	websocketSseFallbackSessions.clear();
969: }
970: 
971: export function closeOpenAICodexWebSocketSessions(sessionId?: string): void {
972: 	const closeEntry = (entry: CachedWebSocketConnection) => {
973: 		if (entry.idleTimer) clearTimeout(entry.idleTimer);
974: 		closeWebSocketSilently(entry.socket, 1000, "debug_close");
975: 	};
976: 	if (sessionId) {
977: 		for (const entry of websocketSessionCache.get(sessionId)?.values() ?? []) closeEntry(entry);
978: 		websocketSessionCache.delete(sessionId);
979: 		return;
980: 	}
981: 	for (const accountEntries of websocketSessionCache.values()) {
982: 		for (const entry of accountEntries.values()) closeEntry(entry);
983: 	}
984: 	websocketSessionCache.clear();
985: }
986: 
987: registerSessionResourceCleanup(closeOpenAICodexWebSocketSessions);
988: 
989: function isWebSocketSseFallbackActive(sessionId: string | undefined): boolean {
990: 	return sessionId ? websocketSseFallbackSessions.has(sessionId) : false;
991: }
992: 
993: function recordWebSocketSseFallback(sessionId: string | undefined): void {
994: 	if (!sessionId) return;
995: 	const stats = getOrCreateWebSocketDebugStats(sessionId);
996: 	stats.sseFallbacks++;
997: 	stats.websocketFallbackActive = isWebSocketSseFallbackActive(sessionId);
998: }
999: 
1000: function recordWebSocketFailure(sessionId: string | undefined, error: unknown): void {
1001: 	if (!sessionId) return;
1002: 	websocketSseFallbackSessions.add(sessionId);
1003: 
1004: 	const stats = getOrCreateWebSocketDebugStats(sessionId);
1005: 	stats.websocketFailures++;
1006: 	stats.lastWebSocketError = formatThrownValue(error);
1007: 	stats.websocketFallbackActive = true;
1008: }
1009: 
1010: type WebSocketConstructor = new (
```
```text
1010: type WebSocketConstructor = new (
1011: 	url: string,
1012: 	protocols?: string | string[] | { headers?: Record<string, string> },
1013: ) => WebSocketLike;
1014: 
1015: let _cachedWebsocket: WebSocketConstructor | null = null;
1016: async function getWebSocketConstructor(env?: ProviderEnv): Promise<WebSocketConstructor | null> {
1017: 	if (!env && _cachedWebsocket) return _cachedWebsocket;
1018: 
1019: 	// bun doesn't respect http proxy envs, ref: https://github.com/oven-sh/bun/issues/15489
1020: 	// TODO: remove this when bun supports proxy envs in websocket.
1021: 	if (typeof process !== "undefined" && process.versions?.bun) {
1022: 		const WebSocketWithProxy = class extends WebSocket {
1023: 			constructor(url: string | URL, options?: string | string[] | Record<string, unknown>) {
1024: 				let _opts: Record<string, unknown> = {};
1025: 				if (Array.isArray(options) || typeof options === "string") {
1026: 					_opts = { protocols: options };
1027: 				} else {
1028: 					_opts = { ...options };
1029: 				}
1030: 
1031: 				const proxyUrl = resolveHttpProxyUrlForTarget(
1032: 					url.toString().replace(/^wss:/, "https:").replace(/^ws:/, "http:"),
1033: 					env,
1034: 				);
1035: 				super(url, { ..._opts, ...(proxyUrl ? { proxy: proxyUrl.toString() } : {}) } as any);
1036: 			}
1037: 		};
1038: 		if (!env) {
1039: 			_cachedWebsocket = WebSocketWithProxy;
1040: 		}
1041: 		return WebSocketWithProxy;
1042: 	}
1043: 
1044: 	const ctor = (globalThis as { WebSocket?: unknown }).WebSocket;
1045: 	if (typeof ctor !== "function") return null;
1046: 	return ctor as unknown as WebSocketConstructor;
1047: }
1048: 
1049: class WebSocketCloseError extends Error {
1050: 	readonly code?: number;
```
```text
1097: async function connectWebSocket(
1098: 	url: string,
1099: 	headers: Headers,
1100: 	signal?: AbortSignal,
1101: 	connectTimeoutMs = DEFAULT_WEBSOCKET_CONNECT_TIMEOUT_MS,
1102: 	env?: ProviderEnv,
1103: ): Promise<WebSocketLike> {
1104: 	const WebSocketCtor = await getWebSocketConstructor(env);
1105: 	if (!WebSocketCtor) {
1106: 		throw new Error("WebSocket transport is not available in this runtime");
1107: 	}
1108: 
1109: 	const wsHeaders = headersToRecord(headers);
1110: 	delete wsHeaders["OpenAI-Beta"];
1111: 
1112: 	return new Promise<WebSocketLike>((resolve, reject) => {
1113: 		let settled = false;
1114: 		let timeout: ReturnType<typeof setTimeout> | undefined;
1115: 		let socket: WebSocketLike;
1116: 
1117: 		try {
1118: 			socket = new WebSocketCtor(url, { headers: wsHeaders });
1119: 		} catch (error) {
1120: 			reject(error instanceof Error ? error : new Error(String(error)));
1121: 			return;
1122: 		}
1123: 
1124: 		const cleanup = () => {
1125: 			if (timeout) {
```
```text
1190: 		const socket = await connectWebSocket(url, headers, signal, connectTimeoutMs, env);
1191: 		return {
1192: 			socket,
1193: 			reused: false,
1194: 			release: () => closeWebSocketSilently(socket),
1195: 		};
1196: 	}
1197: 
1198: 	let accountEntries = websocketSessionCache.get(sessionId);
1199: 	const cached = accountEntries?.get(accountId);
1200: 	if (cached) {
1201: 		if (cached.idleTimer) {
1202: 			clearTimeout(cached.idleTimer);
1203: 			cached.idleTimer = undefined;
1204: 		}
1205: 		if (!cached.busy && isWebSocketSessionExpired(cached)) {
1206: 			closeWebSocketSilently(cached.socket, 1000, "connection_age_limit");
1207: 			accountEntries?.delete(accountId);
1208: 			if (accountEntries?.size === 0) websocketSessionCache.delete(sessionId);
1209: 		} else if (!cached.busy && isWebSocketReusable(cached.socket)) {
1210: 			cached.busy = true;
1211: 			return {
1212: 				socket: cached.socket,
1213: 				entry: cached,
1214: 				reused: true,
1215: 				release: ({ keep } = {}) => {
1216: 					if (!keep || !isWebSocketReusable(cached.socket)) {
1217: 						closeWebSocketSilently(cached.socket);
1218: 						const currentEntries = websocketSessionCache.get(sessionId);
1219: 						if (currentEntries?.get(accountId) === cached) currentEntries.delete(accountId);
1220: 						if (currentEntries?.size === 0) websocketSessionCache.delete(sessionId);
1221: 						return;
1222: 					}
1223: 					cached.busy = false;
1224: 					scheduleSessionWebSocketExpiry(sessionId, accountId, cached);
1225: 				},
1226: 			};
1227: 		}
1228: 		if (cached.busy) {
1229: 			const socket = await connectWebSocket(url, headers, signal, connectTimeoutMs, env);
1230: 			return {
1231: 				socket,
1232: 				reused: false,
1233: 				release: () => {
1234: 					closeWebSocketSilently(socket);
1235: 				},
1236: 			};
1237: 		}
1238: 		if (!isWebSocketReusable(cached.socket)) {
1239: 			closeWebSocketSilently(cached.socket);
1240: 			accountEntries?.delete(accountId);
1241: 			if (accountEntries?.size === 0) websocketSessionCache.delete(sessionId);
1242: 		}
1243: 	}
1244: 
1245: 	const socket = await connectWebSocket(url, headers, signal, connectTimeoutMs, env);
1246: 	const entry: CachedWebSocketConnection = { socket, busy: true, createdAt: Date.now() };
1247: 	accountEntries = websocketSessionCache.get(sessionId);
1248: 	if (!accountEntries) {
1249: 		accountEntries = new Map();
1250: 		websocketSessionCache.set(sessionId, accountEntries);
1251: 	}
1252: 	accountEntries.set(accountId, entry);
1253: 	return {
1254: 		socket,
1255: 		entry,
1256: 		reused: false,
1257: 		release: ({ keep } = {}) => {
1258: 			if (!keep || !isWebSocketReusable(entry.socket)) {
1259: 				closeWebSocketSilently(entry.socket);
1260: 				if (entry.idleTimer) clearTimeout(entry.idleTimer);
1261: 				const currentEntries = websocketSessionCache.get(sessionId);
1262: 				if (currentEntries?.get(accountId) === entry) currentEntries.delete(accountId);
1263: 				if (currentEntries?.size === 0) websocketSessionCache.delete(sessionId);
1264: 				return;
1265: 			}
```
```text
1447: function requestBodyWithoutInput(body: RequestBody): RequestBody {
1448: 	const { input: _input, previous_response_id: _previousResponseId, ...rest } = body;
1449: 	return rest;
1450: }
1451: 
1452: function responseInputsEqual(a: ResponseInput | undefined, b: ResponseInput | undefined): boolean {
1453: 	return JSON.stringify(a ?? []) === JSON.stringify(b ?? []);
1454: }
1455: 
1456: function requestBodiesMatchExceptInput(a: RequestBody, b: RequestBody): boolean {
1457: 	return JSON.stringify(requestBodyWithoutInput(a)) === JSON.stringify(requestBodyWithoutInput(b));
1458: }
1459: 
1460: function getCachedWebSocketInputDelta(
1461: 	body: RequestBody,
1462: 	continuation: CachedWebSocketContinuationState,
1463: ): ResponseInput | undefined {
1464: 	if (!requestBodiesMatchExceptInput(body, continuation.lastRequestBody)) {
1465: 		return undefined;
1466: 	}
1467: 
1468: 	const currentInput = body.input ?? [];
1469: 	const baseline = [...(continuation.lastRequestBody.input ?? []), ...continuation.lastResponseItems];
1470: 	if (currentInput.length < baseline.length) {
1471: 		return undefined;
1472: 	}
1473: 
1474: 	const prefix = currentInput.slice(0, baseline.length);
1475: 	if (!responseInputsEqual(prefix, baseline)) {
1476: 		return undefined;
1477: 	}
1478: 
1479: 	return currentInput.slice(baseline.length);
1480: }
1481: 
1482: function buildCachedWebSocketRequestBody(entry: CachedWebSocketConnection, body: RequestBody): RequestBody {
1483: 	const continuation = entry.continuation;
1484: 	if (!continuation) {
1485: 		return body;
1486: 	}
1487: 
1488: 	const delta = getCachedWebSocketInputDelta(body, continuation);
1489: 	if (!delta || !continuation.lastResponseId) {
1490: 		entry.continuation = undefined;
1491: 		return body;
1492: 	}
1493: 
1494: 	return {
1495: 		...body,
1496: 		previous_response_id: continuation.lastResponseId,
1497: 		input: delta,
1498: 	};
1499: }
1500: 
```
```text
1515: async function processWebSocketStream(
1516: 	url: string,
1517: 	body: RequestBody,
1518: 	headers: Headers,
1519: 	output: AssistantMessage,
1520: 	stream: AssistantMessageEventStream,
1521: 	model: Model<"openai-codex-responses">,
1522: 	onStart: () => void,
1523: 	idleTimeoutMs: number | undefined,
1524: 	websocketConnectTimeoutMs: number | undefined,
1525: 	cacheSessionId: string | undefined,
1526: 	accountId: string,
1527: 	grammarToolInputProperties: ReadonlyMap<string, string>,
1528: 	options?: OpenAICodexResponsesOptions,
1529: ): Promise<void> {
1530: 	const { socket, entry, reused, release } = await acquireWebSocket(
1531: 		url,
1532: 		headers,
1533: 		cacheSessionId,
1534: 		accountId,
1535: 		options?.signal,
1536: 		websocketConnectTimeoutMs,
1537: 		options?.env,
1538: 	);
1539: 	let keepConnection = true;
1540: 	const useCachedContext = options?.transport === "websocket-cached" || options?.transport === "auto";
1541: 	// ChatGPT Codex Responses rejects `store: true` ("Store must be set to false").
1542: 	// WebSocket continuation still works via connection-scoped previous_response_id state.
1543: 	const fullBody = body;
1544: 	const requestBody = useCachedContext && entry ? buildCachedWebSocketRequestBody(entry, fullBody) : fullBody;
1545: 	const stats = cacheSessionId ? getOrCreateWebSocketDebugStats(cacheSessionId) : undefined;
1546: 	if (stats) {
1547: 		stats.requests++;
1548: 		if (reused) stats.connectionsReused++;
1549: 		else stats.connectionsCreated++;
1550: 		if (useCachedContext) stats.cachedContextRequests++;
1551: 		if (requestBody.store === true) stats.storeTrueRequests++;
1552: 		stats.lastInputItems = requestBody.input?.length ?? 0;
1553: 		if (requestBody.previous_response_id) {
1554: 			stats.deltaRequests++;
1555: 			stats.lastDeltaInputItems = requestBody.input?.length ?? 0;
1556: 			stats.lastPreviousResponseId = requestBody.previous_response_id;
1557: 		} else {
1558: 			stats.fullContextRequests++;
1559: 			stats.lastDeltaInputItems = undefined;
1560: 			stats.lastPreviousResponseId = undefined;
1561: 		}
1562: 	}
1563: 	try {
1564: 		socket.send(JSON.stringify({ type: "response.create", ...requestBody }));
1565: 		await processResponsesStream(
1566: 			startWebSocketOutputOnFirstEvent(
1567: 				mapCodexEvents(
1568: 					parseWebSocket(socket, options?.signal, idleTimeoutMs),
1569: 					output,
1570: 					model,
1571: 					options?.onProviderStreamEvent,
1572: 				),
1573: 				onStart,
1574: 			),
1575: 			output,
1576: 			stream,
1577: 			model,
1578: 			{
1579: 				serviceTier: options?.serviceTier,
1580: 				grammarToolInputProperties,
1581: 				resolveServiceTier: resolveCodexServiceTier,
1582: 				applyServiceTierPricing: (usage, serviceTier) => applyServiceTierPricing(usage, serviceTier, model),
1583: 			},
1584: 		);
1585: 		if (options?.signal?.aborted) {
1586: 			keepConnection = false;
1587: 		} else if (useCachedContext && entry && output.responseId) {
1588: 			const responseItems = convertResponsesMessages(
1589: 				model,
1590: 				normalizeContext({ messages: [output] }),
1591: 				CODEX_TOOL_CALL_PROVIDERS,
1592: 				{
1593: 					includeSystemPrompt: false,
1594: 					grammarToolInputProperties,
1595: 				},
1596: 			).filter((item) => item.type !== "function_call_output" && item.type !== "custom_tool_call_output");
1597: 			entry.continuation = {
1598: 				lastRequestBody: fullBody,
1599: 				lastResponseId: output.responseId,
1600: 				lastResponseItems: responseItems,
1601: 			};
1602: 		}
1603: 	} catch (error) {
1604: 		if (entry) {
1605: 			entry.continuation = undefined;
1606: 		}
1607: 		keepConnection = false;
1608: 		throw error;
1609: 	} finally {
1610: 		release({ keep: keepConnection });
1611: 	}
1612: }
1613: 
1614: // ============================================================================
1615: // Error Handling
```

## /private/tmp/axiom-pi14-ws/upstream/pi-coding-agent-1.4.0/package/dist/core/settings-defaults.js
```text
1: import { DEFAULT_MAX_AGENT_RETRY_DELAY_MS } from "@earendil-works/pi-ai/utils/retry";
2: /** Runtime defaults shared by settings accessors and the published JSON Schema. */
3: export const SETTINGS_DEFAULTS = {
4:     transport: "auto",
5:     sessionShareDestination: "auto",
6:     steeringMode: "one-at-a-time",
```

## /private/tmp/axiom-pi14-ws/upstream/pi-coding-agent-1.4.0/package/dist/core/settings-manager.js
```text
613:     getTransport() {
614:         return this.settings.transport ?? SETTINGS_DEFAULTS.transport;
615:     }
616:     setTransport(transport) {
617:         this.globalSettings.transport = transport;
618:         this.markModified("transport");
619:         this.save();
```

## /private/tmp/axiom-pi14-ws/upstream/pi-coding-agent-1.4.0/package/dist/core/sdk.js
```text
275:         onProviderStreamEvent: handleProviderStreamEvent,
276:         sessionId: sessionManager.getSessionId(),
277:         transformContext: async (messages) => {
278:             const runner = extensionRunnerRef.current;
279:             if (!runner)
280:                 return messages;
281:             return runner.emitContext(messages);
282:         },
283:         steeringMode: settingsManager.getSteeringMode(),
284:         followUpMode: settingsManager.getFollowUpMode(),
285:         transport: settingsManager.getTransport(),
286:         thinkingBudgets: settingsManager.getThinkingBudgets(),
287:         maxRetryDelayMs: settingsManager.getProviderRetrySettings().maxRetryDelayMs,
288:     });
289:     // Restore missing settings metadata for older sessions.
```

## /private/tmp/axiom-pi14-ws/upstream/pi-ai-1.4.0/package/dist/types.d.ts
```text
128:     maxTokens?: number;
129:     /**
130:      * Preferred transport for providers that support multiple transports.
131:      * Providers that do not support this option ignore it.
132:      */
133:     transport?: Transport;
134:     /**
135:      * Prompt cache retention preference. Providers map this to their supported values.
136:      * Default: "short".
137:      */
138:     cacheRetention?: CacheRetention;
139:     /**
140:      * Optional session identifier for providers that support session-based caching.
141:      * Providers can use this to enable prompt caching, request routing, or other
142:      * session-aware features. Ignored by providers that don't support it.
143:      */
144:     sessionId?: string;
145:     /**
146:      * WebSocket connect timeout in milliseconds for providers that support
147:      * WebSocket transports. This covers the connection/open handshake only;
148:      * stream idleness after connection uses timeoutMs.
149:      */
150:     websocketConnectTimeoutMs?: number;
151:     /**
```
