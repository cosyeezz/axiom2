# Static LLM dispatch findings
Bound source: @kiro/agent 0.66.70, acp-server.js 15025207 bytes, SHA256 bf79b2b0fa7ae68653abdf117b4a4dbf064fec6fa7ca49500115f3f2f67581b1. Offset convention zero-based raw bytes; lines one-based.
No bundle execution/import, model calls, credentials/settings/HOME reads or network. Python static literal extraction commands exit 0. One complete bundle read for hash and literal location; later only bounded candidate neighborhoods. No AST/runtime validation.

Call relationships:
- byte 14277106 line17354: factory returns new xje(... getKrsClient callback ...).
- byte14277617 line17354: new lzt.KiroRuntimeClient({region:y,endpoint:S,token:{token:g.accessToken},...d,requestHandler:c_e(S,f),customUserAgent:e.userAgent.forSmithy()}). Installs addKrsSseMiddleware, SEi optout, Cy TokenType, _Ei client attribution, bEi attempt header.
- byte8434078 line5153: xje extends T$ chat model. q$=un(Ay(),1) at8432626 binds actual command SDK export, not legacy CodeWhisperer SDK.
- byte8440394 line5153: _streamResponseChunks obtains buildConversationState; _streamResponseChunksOnce at8449291 -> branch selection.
- byte8448761 line5153: usesCreateResponsePath returns AXn(featureConfigRegistry). AXn at8375798 line5148 checks AB_CREATE_RESPONSE_API === "create_response". Effective flag unknown.
- byte8451108 line5153 builds command and client. byte8452434 else branch U.send(J).
- byte8463015 line5153 buildRequestCommand: new q$.GenerateAssistantResponseCommand({conversationState:r,profileArn:n.profileArn,additionalModelRequestFields:i,agentMode:this.agentMode,systemPrompt:o}). agentMode schema is HTTP header x-amzn-kiro-agent-mode (3901249/3897648 line3677), not simply another JSON key. Other listed fields have normal schema body bindings.
- byte8466876 line5153 returns conversationId,rootConversationId,agentContinuationId,agentTaskType,currentMessage,history,chatTriggerType:"MANUAL". ModelId/origin/images/documents in userInputMessage; tools/toolResults under userInputMessageContext; assistantResponseMessage content/toolUses/reasoningContent.
- byte3907103 line3677 SDK GenerateAssistantResponse maps POST /generateAssistantResponse. byte3928834 line3682 SSE middleware directly invokes config.requestHandler.handle(r.request,{}), converting response stream.
- byte3886365 line3677 SDK default endpoint https://runtime.{region}.kiro.dev. Actual caller supplies endpoint from $Y({identity,regionOverride,endpointOverride}); $Y definition and effective endpoint/region not located in bounded windows. c_e underlying handler/proxy resolution also unlocated.

Alternative active-capable branch (not dead SDK declaration):
- byte8451108 line5153 if(h): FOo(...) -> BOo(... endpoint/token/profile/origin/optout/timeouts/TokenType/UA/extraHeaders) -> JOo stream conversion.
- FOo byte8387730 line5149 constructs model,input(history+currentMessage),instructions?,tools?,stream:true,origin,profileArn?,metadata? (kiro:agent_mode/agent_task_type/conversation_id/root_conversation_id/agent_continuation_id),reasoning? (type/effort/summary).
- BOo byte8388768 line5149 uses new URL("/v1/responses",endpoint), JSON.stringify(t), node:https or node:http request POST; headers Content-Type application/json, Authorization Bearer token, x-amzn-kiro-origin, x-amzn-codewhisperer-optout, optional x-amzn-kiro-profile, TokenType, User-Agent, extraHeaders, Content-Length; proxy agent SY(endpoint). Actual serialized byte order depends construction; no wire observed.
- SDK auth scheme HttpBearerAuthSigner byte3908900 line3677.
- Optional middleware Cy3325400, _Ei3324584, bEi3323838; buildRequestCommand also DSt evaluation strategy and conditional EEi test model-caller headers.

Evidence files: windows.json identifies bundle byte/line bases for window-*.txt; extra-*.txt filename gives zero-based base offset; focused.txt and extra-focused.txt reproduce literal neighborhoods. Existing old CodeWhispererStreamingClient schema at11800 is only static existence evidence, not the shown actual q$ caller.

Boundary: statically connected agent model dispatch and two feature-gated APIs, not proof current session executed either, nor server equivalence. Outstanding: outer session factory reachability, $Y endpoint selection, c_e/SY transport details, flag default/effective state, all final SDK headers/wire and backend behavior.
