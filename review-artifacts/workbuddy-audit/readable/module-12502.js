({ 12502(eA, el, ec) {
        "use strict";
        ec.r(el), ec.d(el, { AcpUtils: () => AcpUtils });
        var eu = ec(80699), ed = ec(70724), ep = ec(54601), eg = ec(79896), eh = ec(70857), ef = ec(16928), em = ec(69466), eE = ec(8443), eC = ec(67330), ey = ec(57651), ew = ec(83473), eB = ec(67019), e_ = ec(75796), eI = ec(72297), ev = ec(8046), eS = ec(58830);
        function isRecord(eA) { return "object" == typeof eA && null !== eA && !Array.isArray(eA); }
        function extractPersistedMcpUi(eA) { if (!isRecord(eA))
            return; let el = eA.mcpUi; if (isRecord(el) && "string" == typeof el.toolResourceUri && el.toolResourceUri.length > 0)
            return el; let ec = eA; if (!isRecord(ec.mcpMeta))
            return; let eu = ec.mcpMeta; if ("string" != typeof eu.uiResourceUri || !eu.uiResourceUri)
            return; let ed = Array.isArray(ec.content) ? ec.content : "string" == typeof ec.content ? [{ type: "text", text: ec.content }] : void 0, ep = isRecord(ec.rawResponse) ? ec.rawResponse : void 0; return { toolResourceUri: eu.uiResourceUri, toolResult: { ...ed ? { content: ed } : {}, ...isRecord(eu.structuredContent) ? { structuredContent: eu.structuredContent } : {}, ...isRecord(eu._meta) ? { _meta: eu._meta } : {}, ...ep?.is_error === !0 || "string" == typeof ec.error ? { isError: !0 } : {} } }; }
        let eQ = new Set(["auto", "auto-chat"]);
        let AcpUtils = class AcpUtils {
            static isInternalStreamingUpdate(eA) { if (!eA || "object" != typeof eA)
                return !1; let el = eA.sessionUpdate; return "string" == typeof el && AcpUtils.INTERNAL_STREAMING_UPDATES.has(el); }
            static isInterruptedByUserMessage(eA) { if ("message" !== eA.type || "assistant" !== eA.role)
                return !1; let el = eA.content; return "string" == typeof el ? el === ev.INTERRUPTED_BY_USER_MESSAGE : !!Array.isArray(el) && el.some(eA => "output_text" === eA.type && eA.text === ev.INTERRUPTED_BY_USER_MESSAGE); }
            static getProviderMessageId(eA) { let el = eA?.providerData?.messageId; return "string" == typeof el && el.length > 0 ? el : void 0; }
            static isRecord(eA) { return !!eA && "object" == typeof eA && !Array.isArray(eA); }
            static attachToolMetaData(eA, el) { let ec = AcpUtils.isRecord(eA["codebuddy.ai"]) ? eA["codebuddy.ai"] : {}, eu = AcpUtils.isRecord(ec.toolMetaData) ? ec.toolMetaData : {}; eA["codebuddy.ai"] = { ...ec, toolMetaData: { ...eu, ...el } }; }
            static parseToRecord(eA, el) { if (eA) {
                if ("string" == typeof eA)
                    try {
                        return JSON.parse(eA);
                    }
                    catch {
                        return { [el]: eA };
                    }
                return "object" == typeof eA ? eA : { [el]: eA };
            } }
            static parseFunctionCallRawInput(eA) { let el = eA.providerData && "object" == typeof eA.providerData ? eA.providerData : void 0, ec = el?.rawItem && "object" == typeof el.rawItem ? el.rawItem : void 0, eu = el?.toolCall && "object" == typeof el.toolCall ? el.toolCall : void 0, ed = el?.toolUse && "object" == typeof el.toolUse ? el.toolUse : void 0; for (let ep of [eA.arguments, eA.rawInput, eA.input, eA.parameters, el?.rawInput, el?.input, el?.arguments, ec?.arguments, ec?.rawInput, ec?.input, eu?.input, eu?.function?.arguments, ed?.input]) {
                let eA = AcpUtils.parseToRecord(ep, "arguments");
                if (void 0 !== eA)
                    return eA;
            } return {}; }
            static parseFunctionCallResultRawInput(eA) { let el = eA.providerData && "object" == typeof eA.providerData ? eA.providerData : void 0, ec = el?.rawItem && "object" == typeof el.rawItem ? el.rawItem : void 0, eu = el?.toolCall && "object" == typeof el.toolCall ? el.toolCall : void 0, ed = el?.toolUse && "object" == typeof el.toolUse ? el.toolUse : void 0; for (let ep of [eA.rawInput, eA.input, eA.parameters, eA.arguments, el?.rawInput, el?.input, el?.arguments, ec?.arguments, ec?.rawInput, ec?.input, eu?.input, eu?.function?.arguments, ed?.input]) {
                let eA = AcpUtils.parseToRecord(ep, "arguments");
                if (void 0 !== eA && Object.keys(eA).length > 0)
                    return eA;
            } }
            static convertTodosToPlanEntries(eA) { return (0, ey.getVisibleTodoItems)(eA.newTodos ?? eA.todos ?? []).map((eA, el) => ({ content: eA.content, status: eA.status, priority: "medium", _meta: { id: eA.id ?? `task-${el}`, ...eA.dependencies && eA.dependencies.length > 0 ? { dependencies: eA.dependencies } : {}, "codebuddy.ai": { id: eA.id ?? `task-${el}`, activeForm: eA.activeForm ?? eA.content, ...eA.dependencies && eA.dependencies.length > 0 ? { dependencies: eA.dependencies } : {}, order: el } } })); }
            static convertHistoryItemToAcp(eA) { if ("message" === eA.type && "user" === eA.role) {
                if (eA.providerData?.isMeta === !0 && !eA.providerData?.isCompactInternal)
                    return [];
                if (eA.providerData?.goalStatus)
                    return [{ sessionUpdate: "session_info_update", _meta: { "codebuddy.ai/goalStatus": { ...eA.providerData.goalStatus, id: eA.id } } }];
                let el = eA.content;
                if (!el)
                    return [];
                let ec = eA.id || `user-${eA.timestamp || Date.now()}`, eu = { "codebuddy.ai/messageId": ec };
                if (eA.providerData?.isCompactInternal && (eu["codebuddy.ai/isCompactInternal"] = !0), eA.providerData?.compactType && (eu[eC.ACP_META_COMPACT_TYPE] = eA.providerData.compactType), eS.InputItemUtils.isCompactContinuePromptMessage(eA))
                    return [];
                if (eS.InputItemUtils.isCompactBoundaryMessage(eA))
                    return [{ sessionUpdate: "agent_message_chunk", messageId: ec, content: { type: "text", text: "string" == typeof el ? el : el.filter(eA => "input_text" === eA.type && eA.text).map(eA => eA.text).join("\n") }, _meta: { ...eu, "codebuddy.ai/isCompactInternal": !0 } }];
                if ("string" == typeof el) {
                    let eA = el, ep = AcpUtils.extractChannelInfo(eA);
                    if (eA = (0, ed.stripPromptContextXml)(eA), ep && (eA = ep.content), eB.CommandMessageUtils.isSystemInternalMessage(eA) || !eA)
                        return [];
                    let eg = eB.CommandMessageUtils.parseInput(eA);
                    if (eg) {
                        let eA = { ...eu };
                        return ep && (eA["codebuddy.ai/channelSource"] = ep.source, eA["codebuddy.ai/channelSender"] = ep.sender, ep.chatId && (eA["codebuddy.ai/channelChatId"] = ep.chatId), ep.chatType && (eA["codebuddy.ai/channelChatType"] = ep.chatType)), eg.type === eB.CommandType.COMMAND && (eA["codebuddy.ai/commandKind"] = "slash"), [{ sessionUpdate: "user_message_chunk", messageId: ec, content: { type: "text", text: eg.text }, ...Object.keys(eA).length > 0 && { _meta: eA } }];
                    }
                    let eh = eB.CommandMessageUtils.parseOutput(eA);
                    if (eh && eh.text.trim()) {
                        let eA = eh.text.replace(/\n\n {2}Scan to open Web UI:\n[\s\S]*$/, "");
                        return [{ sessionUpdate: "agent_message_chunk", messageId: ec, content: { type: "text", text: "```\n" + (eA = ew.AnsiUtils.replaceAnsiColor(eA)).trimEnd() + "\n```" } }];
                    }
                    let ef = { ...eu };
                    return ep && (ef["codebuddy.ai/channelSource"] = ep.source, ef["codebuddy.ai/channelSender"] = ep.sender, ep.chatId && (ef["codebuddy.ai/channelChatId"] = ep.chatId), ep.chatType && (ef["codebuddy.ai/channelChatType"] = ep.chatType)), [{ sessionUpdate: "user_message_chunk", messageId: ec, content: { type: "text", text: eA }, ...Object.keys(ef).length > 0 && { _meta: ef } }];
                }
                if (Array.isArray(el)) {
                    let eA = [], ep = el.filter(eA => "input_text" === eA.type).map(eA => eA.text).join("\n"), eg = AcpUtils.extractChannelInfo(ep), eh = [];
                    for (let ed of el) {
                        if (ed?.type === "input_text" && "string" == typeof ed.text) {
                            let el = ed.text;
                            if (eB.CommandMessageUtils.isSystemInternalMessage(el)) {
                                eh.push(ed);
                                continue;
                            }
                            if (AcpUtils.isImageLocalPathText(el))
                                continue;
                            let ep = eB.CommandMessageUtils.parseInput(el);
                            if (ep) {
                                let el = { ...eu };
                                0 === eA.length && eg && (el["codebuddy.ai/channelSource"] = eg.source, el["codebuddy.ai/channelSender"] = eg.sender, eg.chatId && (el["codebuddy.ai/channelChatId"] = eg.chatId), eg.chatType && (el["codebuddy.ai/channelChatType"] = eg.chatType)), ep.type === eB.CommandType.COMMAND && (el["codebuddy.ai/commandKind"] = "slash"), eA.push({ sessionUpdate: "user_message_chunk", messageId: ec, content: { type: "text", text: ep.text }, ...Object.keys(el).length > 0 && { _meta: el } });
                                continue;
                            }
                            let ef = eB.CommandMessageUtils.parseOutput(el);
                            if (ef) {
                                if (ef.text.trim()) {
                                    let el = ef.text.replace(/\n\n {2}Scan to open Web UI:\n[\s\S]*$/, "");
                                    el = ew.AnsiUtils.replaceAnsiColor(el), eA.push({ sessionUpdate: "agent_message_chunk", messageId: ec, content: { type: "text", text: "```\n" + el.trimEnd() + "\n```" } });
                                }
                                continue;
                            }
                        }
                        eh.push(ed);
                    }
                    if (eh.length > 0)
                        for (let el of (0, ed.decodePersistedUserContentToAcpContentBlocks)(eh, { convertPersistedImageBlock: eA => this.convertPersistedUserImageBlockToAcpContentBlock(eA) })) {
                            let ep = { ...eu };
                            if (0 === eA.length && eg && (ep["codebuddy.ai/channelSource"] = eg.source, ep["codebuddy.ai/channelSender"] = eg.sender, eg.chatId && (ep["codebuddy.ai/channelChatId"] = eg.chatId), eg.chatType && (ep["codebuddy.ai/channelChatType"] = eg.chatType)), "text" === el.type) {
                                let eu = el.text || "";
                                if (eg && 0 === eA.length && (eu = eg.content), (eu.includes("<system-reminder") || eu.includes("<user_query>")) && (eu = (0, ed.stripPromptContextXml)(eu)), !eu || eB.CommandMessageUtils.isSystemInternalMessage(eu) || AcpUtils.isImageLocalPathText(eu))
                                    continue;
                                eA.push({ sessionUpdate: "user_message_chunk", messageId: ec, content: { type: "text", text: eu }, ...Object.keys(ep).length > 0 && { _meta: ep } });
                                continue;
                            }
                            let eh = el._meta?.filename || el.uri;
                            eh && "image" === el.type && (ep["codebuddy.ai/filename"] = eh), eA.push({ sessionUpdate: "user_message_chunk", messageId: ec, content: el, ...Object.keys(ep).length > 0 && { _meta: ep } });
                        }
                    return eA;
                }
                return [];
            } if ("message" === eA.type && "assistant" === eA.role) {
                let el = eA.content;
                if (!el || eA.providerData?.skipRun === !0 && ("incomplete" === eA.status || eA.providerData?.error) && !AcpUtils.isInterruptedByUserMessage(eA))
                    return [];
                let ec = "";
                if ("string" == typeof el ? ec = el : Array.isArray(el) && (ec = el.filter(eA => "output_text" === eA.type).map(eA => eA.text).join("\n")), !ec)
                    return [];
                let eu = eA.providerData?.isCompactInternal || eA.providerData?.agent === em.AgentNames.COMPACT, ed = AcpUtils.getProviderMessageId(eA) || eA.id || `assistant-${eA.timestamp || Date.now()}`, ep = { "codebuddy.ai/messageId": ed };
                eu && (ep["codebuddy.ai/isCompactInternal"] = !0), eA.providerData?.contentFilterNotice && (ep[eC.ACP_META_CONTENT_FILTER_NOTICE] = !0), eA.providerData?.compactType && (ep[eC.ACP_META_COMPACT_TYPE] = eA.providerData.compactType), eA.providerData?.traceId && (ep["codebuddy.ai/traceId"] = eA.providerData.traceId), eA.providerData?.conversationRequestId && (ep["codebuddy.ai/requestId"] = eA.providerData.conversationRequestId);
                let eg = eA.providerData?.requestModelId || eA.providerData?.model, eh = eA.providerData?.requestModelName || eA.providerData?.modelName, ef = eA.providerData?.model, eE = ef && ef !== eA.providerData?.requestModelId && !eQ.has(ef) ? ef : void 0;
                return eg && (ep["codebuddy.ai/requestModelId"] = eg), eh && (ep["codebuddy.ai/requestModelName"] = eh), eE && (ep["codebuddy.ai/responseModelId"] = eE), [{ sessionUpdate: "agent_message_chunk", messageId: ed, content: { type: "text", text: ec }, _meta: ep }];
            } if ("function_call" === eA.type || "function_call_result" === eA.type || "function_call_output" === eA.type) {
                let el = AcpUtils.convertInputItemToAcp(eA, {});
                return el ? [el] : [];
            } if ("reasoning" === eA.type) {
                let el = AcpUtils.getProviderMessageId(eA) || ("string" == typeof eA.id ? eA.id : void 0), ec = eA.rawContent;
                if (!ec || 0 === ec.length)
                    return [];
                let eu = ec.filter(eA => "reasoning_text" === eA.type && eA.text).map(eA => eA.text).join("");
                return eu ? [{ sessionUpdate: "agent_thought_chunk", ...el ? { messageId: el } : {}, content: { type: "text", text: eu }, ...el ? { _meta: { "codebuddy.ai/messageId": el } } : {} }] : [];
            } if ("message" === eA.type && "system" === eA.role) {
                let el = eA.providerData;
                if (el?.isSessionSeparator === !0) {
                    let ec = el.separatorMessageId ?? eA.id;
                    return ec ? [{ sessionUpdate: "session_info_update", _meta: { "codebuddy.ai": { isHistoryReplay: !0, messageId: ec, isSessionSeparator: !0, separatorExtra: el.separatorExtra && "object" == typeof el.separatorExtra ? el.separatorExtra : { isSessionSeparator: !0 } } } }] : [];
                }
                return [];
            } return "goal-progress" === eA.type ? [{ sessionUpdate: "session_info_update", _meta: { "codebuddy.ai/goalProgress": { id: eA.id, condition: eA.condition, reason: eA.reason, turnCount: eA.turnCount } } }] : []; }
            static convertInputItemToAcp(eA, el = {}, ec) { let ed = ec?.parentToolUseId ? { "codebuddy.ai/parentToolCallId": ec.parentToolUseId } : void 0; if ("function_call" === eA.type) {
                let ec = eA, ep = AcpUtils.getProviderMessageId(eA) || ("string" == typeof ec.id ? ec.id : void 0);
                if (ec.name === ey.ToolNames.TODO_WRITE)
                    try {
                        let eA = JSON.parse(ec.arguments), el = eA?.newTodos ?? eA?.todos;
                        if ("string" == typeof el)
                            try {
                                el = JSON.parse(el);
                            }
                            catch { }
                        if (Array.isArray(el))
                            return { sessionUpdate: "plan", entries: AcpUtils.convertTodosToPlanEntries({ ...eA, newTodos: el }) };
                    }
                    catch (eA) {
                        eu.ContainerUtil.get(eE.ConsoleManager).error("[AcpUtils] Failed to parse TodoWrite input:", eA);
                    }
                let eg = AcpUtils.parseFunctionCallRawInput(ec), eh = AcpUtils.toolInfoFromToolUse({ name: ec.name, input: eg }, el), ef = { ...{ "codebuddy.ai/toolName": ec.name, "codebuddy.ai/toolArgumentsComplete": !0, ...ep ? { "codebuddy.ai/messageId": ep } : {} }, ...ed, ...eh._meta };
                if (ec.name === ey.ToolNames.EXIT_PLAN_MODE) {
                    let eA = ec.providerData?.toolResult?.content;
                    eA && "string" == typeof eA && (ef["codebuddy.ai/planContent"] = eA);
                }
                return { sessionUpdate: "tool_call", ...ep ? { messageId: ep } : {}, toolCallId: ec.callId, status: "completed" === ec.status ? "completed" : "in_progress" === ec.status ? "in_progress" : "incomplete" === ec.status ? "failed" : "pending", rawInput: eg, title: eh.title, kind: eh.kind, content: eh.content, locations: eh.locations, ...ef && { _meta: ef } };
            } if ("function_call_result" === eA.type || "function_call_output" === eA.type) {
                let el = eA, ec = AcpUtils.getProviderMessageId(eA);
                if (el.name === ey.ToolNames.TODO_WRITE)
                    return null;
                let { acpStatus: eu, businessFailed: ep } = AcpUtils.resolveAcpToolStatus(el), eg = AcpUtils.parseFunctionCallResultRawInput(el), eh = { ...ed || {} };
                "string" == typeof el.name && el.name.length > 0 && (eh["codebuddy.ai/toolName"] = el.name), ec && (eh["codebuddy.ai/messageId"] = ec);
                let ef = el.providerData?.toolResult?.rawResponse;
                void 0 !== ef && (eh["codebuddy.ai/rawResponse"] = ef);
                let em = extractPersistedMcpUi(el.providerData?.toolResult);
                em && AcpUtils.attachToolMetaData(eh, { mcpUi: em }), ep && (eh["codebuddy.ai/businessFailed"] = !0);
                let eE = Object.keys(eh).length > 0;
                return el.name === ey.ToolNames.BASH ? "failed" === eu && el.output ? { sessionUpdate: "tool_call_update", ...ec ? { messageId: ec } : {}, toolCallId: el.callId, status: eu, content: [AcpUtils.wrapInCodeBlock(el.output)], ...eg ? { rawInput: eg } : {}, rawOutput: AcpUtils.parseToRecord(el.output, "output"), ...eE && { _meta: eh } } : { sessionUpdate: "tool_call_update", ...ec ? { messageId: ec } : {}, toolCallId: el.callId, status: eu, ...eg ? { rawInput: eg } : {}, rawOutput: AcpUtils.parseToRecord(el.output, "output"), ...eE && { _meta: eh } } : { sessionUpdate: "tool_call_update", ...ec ? { messageId: ec } : {}, toolCallId: el.callId, status: eu, content: el.output ? [AcpUtils.convertToolResultToAcp(el.output)] : void 0, ...eg ? { rawInput: eg } : {}, rawOutput: AcpUtils.parseToRecord(el.output, "output"), ...eE && { _meta: eh } };
            } return null; }
            static resolveAcpToolStatus(eA) { let el = eA.providerData?.error, ec = eA.providerData?.toolResult?.error; if (AcpUtils.isTruthyErrorField(el) || AcpUtils.isTruthyErrorField(ec))
                return { acpStatus: "failed", businessFailed: "completed" === eA.status }; switch (eA.status) {
                case "completed": return { acpStatus: "completed", businessFailed: !1 };
                case "in_progress": return { acpStatus: "in_progress", businessFailed: !1 };
                case "incomplete": return { acpStatus: "failed", businessFailed: !1 };
                default: return { acpStatus: "pending", businessFailed: !1 };
            } }
            static isTruthyErrorField(eA) { if (!eA)
                return !1; if ("string" == typeof eA)
                return eA.trim().length > 0; if ("object" == typeof eA) {
                let el = eA.message;
                return "string" == typeof el && el.trim().length > 0 || Object.keys(eA).length > 0;
            } return !1; }
            static convertOpenAIEventToAcp(eA) { switch (eA.type) {
                case "output_text_delta": return [{ sessionUpdate: "agent_message_chunk", content: { type: "text", text: eA.delta } }];
                case "response_started":
                case "response_done":
                default: return [];
                case "model": {
                    let el = eA.event;
                    if (!el)
                        return [];
                    let ec = [], eu = !1, ed = el.choices;
                    if (ed?.[0]?.delta) {
                        let eA = ed[0].delta, el = "reasoning_content" in eA && "string" == typeof eA.reasoning_content && "" !== eA.reasoning_content ? eA.reasoning_content : void 0, ep = eA.tool_calls, eg = [];
                        if (Array.isArray(ep) && ep.length > 0) {
                            for (let eA of ep) {
                                if (!eA)
                                    continue;
                                let el = eA.index, ec = "string" == typeof eA.id, eu = eA.function?.name;
                                ec ? eg.push({ sessionUpdate: "tool_call_pending", toolCallId: eA.id, toolName: eu, toolCallIndex: el }) : eu && eg.push({ sessionUpdate: "tool_call_pending", toolCallId: void 0, toolName: eu, toolCallIndex: el });
                                let ed = eA.function?.arguments;
                                "string" == typeof ed && ed.length > 0 && eg.push({ sessionUpdate: "tool_call_arguments_delta", toolCallId: ec ? eA.id : void 0, toolCallIndex: el, argumentsDelta: ed, toolName: eu });
                            }
                            eu = !0;
                        }
                        void 0 !== el && ec.push(AcpUtils.withSourceEventMeta({ sessionUpdate: "agent_thought_chunk", content: { type: "text", text: el } }, eu ? ["reasoning", "tool"] : ["reasoning"])), ec.push(...eg);
                    }
                    switch (el.type) {
                        case "response.output_item.added": {
                            let eA = el.item;
                            eA?.type === "function_call" && eA.call_id && eA.name && ec.push({ sessionUpdate: "tool_call_pending", toolCallId: eA.call_id, toolName: eA.name });
                            break;
                        }
                        case "response.content_part.added": break;
                        case "response.text.delta": {
                            let eA = el.delta;
                            eA && ec.push({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: eA } });
                            break;
                        }
                        case "response.function_call_arguments.delta": {
                            let eA = el.call_id, eu = el.delta;
                            eA && "string" == typeof eu && eu.length > 0 && ec.push({ sessionUpdate: "tool_call_arguments_delta", toolCallId: eA, argumentsDelta: eu });
                            break;
                        }
                        case "response.function_call_arguments.done": {
                            let eA = el.call_id, eu = el.arguments;
                            eA && "string" == typeof eu && ec.push({ sessionUpdate: "tool_call_arguments_done", toolCallId: eA, argumentsFinal: eu });
                        }
                    }
                    return ec;
                }
            } }
            static withSourceEventMeta(eA, el) { let ec = eA._meta; return { ...eA, _meta: { ...ec ?? {}, [AcpUtils.SOURCE_EVENT_META_KEY]: { facets: el } } }; }
            static wrapInCodeBlock(eA) {
                let el;
                return el = "string" == typeof eA ? eA : eA && "object" == typeof eA && "text" === eA.type && eA.text ? eA.text : JSON.stringify(eA, null, 2), { type: "content", content: { type: "text", text: `\`\`\`
${el}
\`\`\`` } };
            }
            static convertToolResultToAcp(eA) { if ("string" == typeof eA) {
                try {
                    let el = JSON.parse(eA);
                    if (Array.isArray(el) && el.length > 0) {
                        let eA = el.find(eA => "image_url" === eA.type || "image" === eA.type);
                        if (eA)
                            return AcpUtils.convertToolResultToAcp(eA);
                    }
                }
                catch { }
                return { type: "content", content: { type: "text", text: eA } };
            } if (Array.isArray(eA) && eA.length > 0) {
                let el = eA.find(eA => "image_url" === eA.type || "image" === eA.type);
                return el ? AcpUtils.convertToolResultToAcp(el) : { type: "content", content: { type: "text", text: JSON.stringify(eA, null, 2) } };
            } if (eA && "object" == typeof eA) {
                if ("text" === eA.type && eA.text) {
                    try {
                        let el = JSON.parse(eA.text);
                        if (Array.isArray(el) && el.length > 0) {
                            let eA = el.find(eA => "image_url" === eA.type || "image" === eA.type);
                            if (eA)
                                return AcpUtils.convertToolResultToAcp(eA);
                        }
                    }
                    catch { }
                    return { type: "content", content: { type: "text", text: eA.text } };
                }
                if ("image" === eA.type && eA.data)
                    return { type: "content", content: { type: "image", data: eA.data, mimeType: eA.mediaType || eA.mimeType || "image/png" } };
                if ("image_url" === eA.type && eA.image_url?.url) {
                    let el = eA.image_url.url, ec = el.match(/^data:([^;]+);base64,(.+)$/);
                    return ec ? { type: "content", content: { type: "image", data: ec[2], mimeType: ec[1] } } : { type: "content", content: { type: "image_url", url: el } };
                }
            } return { type: "content", content: { type: "text", text: JSON.stringify(eA, null, 2) } }; }
            static extractChannelInfo(eA) { let el, ec, eu = /<channel\s+([^>]*)>([^<]*)<\/channel>/, ed = [...eA.matchAll(RegExp(eu, "g"))], ep = ed.length > 0 ? ed[ed.length - 1] : null; if (!ep)
                return null; let eg = ep[1], eh = ep[2].replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").trim(), ef = {}, em = /(\w+)="([^"]*)"/g; for (; null !== (el = em.exec(eg));) {
                let eA = el[2].replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
                ef[el[1]] = eA;
            } let eE = ef.source; return eE ? ("group" === ef.chattype ? ec = "group" : "single" === ef.chattype && (ec = "single"), { source: eE, sender: ef.sender || ef.user || "", chatId: ef.chat_id, chatType: ec, content: eh }) : null; }
            static inferToolKind(eA) { let el = eA.toLowerCase(); return el.includes("read") || el.includes("list") || el.includes("glob") || el.includes("grep") ? "read" : el.includes("edit") || el.includes("write") || el.includes("multiedit") ? "edit" : el.includes("delete") || el.includes("remove") ? "delete" : el.includes("move") || el.includes("rename") ? "move" : el.includes("search") ? "search" : el.includes("bash") || el.includes("execute") ? "execute" : el.includes("fetch") || el.includes("web") ? "fetch" : "other"; }
            static convertAcpMcpServersToDynamic(eA) { let el = {}; for (let ec of eA) {
                let eA, eu = ec._meta || {};
                if ("type" in ec) {
                    if ("http" !== ec.type && "sse" !== ec.type)
                        continue;
                    eA = { type: ec.type, url: ec.url, headers: ec.headers ? Object.fromEntries(ec.headers.map(eA => [eA.name, eA.value])) : void 0, ...void 0 !== eu.defer_loading ? { defer_loading: eu.defer_loading } : {}, ...eu.tools ? { tools: eu.tools } : {}, ...void 0 !== eu.transparent_proxy ? { transparent_proxy: eu.transparent_proxy } : {}, ...eu.builtin_tools ? { builtin_tools: eu.builtin_tools } : {} };
                }
                else
                    eA = { type: "stdio", command: ec.command, args: ec.args, env: ec.env ? Object.fromEntries(ec.env.map(eA => [eA.name, eA.value])) : void 0, ...void 0 !== eu.defer_loading ? { defer_loading: eu.defer_loading } : {}, ...eu.tools ? { tools: eu.tools } : {}, ...void 0 !== eu.transparent_proxy ? { transparent_proxy: eu.transparent_proxy } : {}, ...eu.builtin_tools ? { builtin_tools: eu.builtin_tools } : {} };
                el[ec.name] = eA;
            } return el; }
            static toolInfoFromToolUse(eA, el = {}) { let ec = eA.name, eu = eA.input; switch (ec) {
                case ey.ToolNames.READ: {
                    let eA = "";
                    return eu?.limit ? eA = ` (${(eu.offset ?? 0) + 1} - ${(eu.offset ?? 0) + eu.limit})` : eu?.offset && (eA = ` (from line ${eu.offset + 1})`), { title: `Read ${eu?.file_path ?? "File"}${eA}`, kind: "read", content: [], locations: eu?.file_path ? [{ path: eu.file_path, line: eu.offset ?? 0 }] : [] };
                }
                case ey.ToolNames.EDIT: {
                    let eA = eu?.file_path, ec = eu?.old_string ?? null, ed = eu?.new_string ?? "", ep = [];
                    if (eA && ec && Object.prototype.hasOwnProperty.call(el, eA))
                        try {
                            let eg = el[eA] ?? "", eh = eI.EditFileUtils.applyTextReplacementWithLocation(eg, [{ oldString: ec, newString: ed, replaceAll: eu?.replace_all ?? !1 }]);
                            ec = eg, ed = eh.newContent, ep = eh.affectedLines;
                        }
                        catch { }
                    return { title: eA ? `Edit \`${eA}\`` : "Edit", kind: "edit", content: eu && eA ? [{ type: "diff", path: eA, oldText: ec, newText: ed }] : [], locations: eA ? ep.length > 0 ? ep.map(el => ({ line: el, path: eA })) : [{ path: eA }] : [] };
                }
                case ey.ToolNames.MULTI_EDIT: {
                    let eA = eu?.file_path, ec = null, ed = "", ep = [];
                    if (eA && eu?.edits && Array.isArray(eu.edits)) {
                        let eg = eu.edits;
                        if (ec = eg.map(eA => eA.old_string ?? "").join("\n...\n"), ed = eg.map(eA => eA.new_string ?? "").join("\n...\n"), Object.prototype.hasOwnProperty.call(el, eA))
                            try {
                                let eu = el[eA] ?? "", eh = eI.EditFileUtils.applyTextReplacementWithLocation(eu, eg.map(eA => ({ oldString: eA.old_string, newString: eA.new_string, replaceAll: eA.replace_all ?? !1 })));
                                ec = eu, ed = eh.newContent, ep = eh.affectedLines;
                            }
                            catch { }
                    }
                    return { title: eA ? `Edit \`${eA}\`` : "Multi Edit", kind: "edit", content: eu && eA ? [{ type: "diff", path: eA, oldText: ec, newText: ed }] : [], locations: eA ? ep.length > 0 ? ep.map(el => ({ line: el, path: eA })) : [{ path: eA }] : [] };
                }
                case ey.ToolNames.WRITE: return { title: eu?.file_path ? `Write ${eu.file_path}` : "Write", kind: "edit", content: eu && eu.file_path ? [{ type: "diff", path: eu.file_path, oldText: null, newText: eu.content }] : [], locations: eu?.file_path ? [{ path: eu.file_path }] : [] };
                case ey.ToolNames.BASH: return { title: eu?.command ? "`" + eu.command.replace(/`/g, "\\`") + "`" : "Terminal", kind: "execute", content: eu && eu.description ? [{ type: "content", content: { type: "text", text: eu.description } }] : [] };
                case ey.ToolNames.POWERSHELL: return { title: eu?.command ? "`" + eu.command.replace(/`/g, "\\`") + "`" : "PowerShell", kind: "execute", content: eu && eu.description ? [{ type: "content", content: { type: "text", text: eu.description } }] : [] };
                case ey.ToolNames.BASH_OUTPUT: return { title: "Tail Logs", kind: "execute", content: [] };
                case ey.ToolNames.KILL_SHELL: return { title: "Kill Process", kind: "execute", content: [] };
                case ey.ToolNames.GLOB: {
                    let eA = "Find";
                    return eu?.path && (eA += ` \`${eu.path}\``), eu?.pattern && (eA += ` \`${eu.pattern}\``), { title: eA, kind: "search", content: [], locations: eu?.path ? [{ path: eu.path }] : [] };
                }
                case ey.ToolNames.GREP: {
                    let eA = "grep";
                    if (eu?.["-i"] && (eA += " -i"), eu?.["-n"] && (eA += " -n"), eu?.["-A"] !== void 0 && (eA += ` -A ${eu["-A"]}`), eu?.["-B"] !== void 0 && (eA += ` -B ${eu["-B"]}`), eu?.["-C"] !== void 0 && (eA += ` -C ${eu["-C"]}`), eu?.output_mode)
                        switch (eu.output_mode) {
                            case "files_with_matches":
                                eA += " -l";
                                break;
                            case "count": eA += " -c";
                        }
                    return eu?.head_limit !== void 0 && (eA += ` | head -${eu.head_limit}`), eu?.glob && (eA += ` --include="${eu.glob}"`), eu?.type && (eA += ` --type=${eu.type}`), eu?.multiline && (eA += " -P"), eA += ` "${eu?.pattern}"`, eu?.path && (eA += ` ${eu.path}`), { title: eA, kind: "search", content: [] };
                }
                case ey.ToolNames.WEB_FETCH: return { title: eu?.url ? `Fetch ${eu.url}` : "Fetch", kind: "fetch", content: eu && eu.prompt ? [{ type: "content", content: { type: "text", text: eu.prompt } }] : [] };
                case ey.ToolNames.WEB_SEARCH: {
                    let eA = `"${eu?.query}"`;
                    return eu?.allowed_domains && eu.allowed_domains.length > 0 && (eA += ` (allowed: ${eu.allowed_domains.join(", ")})`), eu?.blocked_domains && eu.blocked_domains.length > 0 && (eA += ` (blocked: ${eu.blocked_domains.join(", ")})`), { title: eA, kind: "fetch", content: [] };
                }
                case ey.ToolNames.TODO_WRITE: return { title: Array.isArray(eu?.todos) ? `Update TODOs: ${eu.todos.map(eA => eA.content).join(", ")}` : "Update TODOs", kind: "think", content: [] };
                case ey.ToolNames.AGENT: {
                    let eA = eu?.description || "", el = eu?.subagent_type || "general-purpose", ec = !!eu?.run_in_background, ed = eu?.name;
                    return { title: ed ? `@${ed}` : el, kind: "other", content: eA ? [{ type: "content", content: { type: "text", text: eA } }] : [], _meta: { "codebuddy.ai/isSubagent": !0, "codebuddy.ai/subagentType": el, "codebuddy.ai/isBackground": ec, "codebuddy.ai/memberName": ed || null, "codebuddy.ai/description": eA } };
                }
                default: return { title: ec || "Unknown Tool", kind: "other", content: [] };
            } }
            static getImageExtension(eA) { switch (eA) {
                case "image/jpeg": return ".jpg";
                case "image/gif": return ".gif";
                case "image/webp": return ".webp";
                default: return ".png";
            } }
            static persistClipboardImage(eA, el) { try {
                let ec = process.env.CODEBUDDY_CONFIG_DIR ? ef.join(process.env.CODEBUDDY_CONFIG_DIR, "clipboard-images") : ef.join(eh.tmpdir(), "workbuddy-clipboard-images");
                eg.mkdirSync(ec, { recursive: !0 });
                let eu = new Date().toISOString().replace(/[:.]/g, "-"), ed = ep.createHash("sha1").update(eA).digest("hex").slice(0, 8), em = this.getImageExtension(el), eE = ef.join(ec, `clipboard-${eu}-${ed}${em}`);
                return eg.writeFileSync(eE, Buffer.from(eA, "base64")), eE;
            }
            catch (eA) {
                e_.DebugLogger.error("AcpUtils", "Failed to persist clipboard image", eA).catch(() => { });
                return;
            } }
            static promptToUserMessage(eA) {
                let el = [], ec = [];
                for (let eu of eA.prompt)
                    switch (eu.type) {
                        case "text": {
                            let eA = eu.text, ec = eA.match(/^\/mcp:([^:\s]+):(\S+)(\s+.*)?$/);
                            if (ec) {
                                let [, el, eu, ed] = ec;
                                eA = `/${el}:${eu} (MCP)${ed || ""}`;
                            }
                            el.push({ type: "text", text: eA });
                            break;
                        }
                        case "resource_link": {
                            let eA = eu._meta || {};
                            if ("inspiration" === eA.mentionType && eA.detail) {
                                let el = eA.cardTitle || eu.name || "Inspiration";
                                ec.push({ type: "text", text: `
<context ref="inspiration:${eA.inspirationCardId || ""}" title="${el}">
${eA.detail}
</context>` });
                            }
                            else {
                                let eA = this.formatUriAsLink(eu.uri, eu.name);
                                el.push({ type: "text", text: eA });
                            }
                            break;
                        }
                        case "resource":
                            if ("text" in eu.resource) {
                                let eA = this.formatUriAsLink(eu.resource.uri);
                                el.push({ type: "text", text: eA }), ec.push({ type: "text", text: `
<context ref="${eu.resource.uri}">
${eu.resource.text}
</context>` });
                            }
                            break;
                        case "image": if (eu.data) {
                            let eA, ec = eu._meta?.filename ?? eu._meta?.originalFilename, ed = { type: "image", source: { type: "base64", data: eu.data, media_type: eu.mimeType }, original_filename: "string" == typeof ec ? ec : void 0 };
                            el.push(ed);
                            let ep = "string" == typeof eu._meta?.path ? eu._meta.path : void 0;
                            (eA = ep && ef.isAbsolute(ep) && eg.existsSync(ep) ? ep : "string" == typeof eu.uri && ef.isAbsolute(eu.uri) && eg.existsSync(eu.uri) ? eu.uri : AcpUtils.persistClipboardImage(eu.data, eu.mimeType)) && el.push({ type: "text", text: `<image_local_path>${eA}</image_local_path>` });
                        }
                        else
                            eu.uri && eu.uri.startsWith("http") && el.push({ type: "image", source: { type: "url", url: eu.uri } });
                    }
                return el.push(...ec), { type: "user", message: { role: "user", content: el }, session_id: eA.sessionId, parent_tool_use_id: null };
            }
            static isImageLocalPathText(eA) { return /^<image_local_path>[\s\S]*<\/image_local_path>$/.test(eA.trim()); }
            static convertPersistedUserImageBlockToAcpContentBlock(eA) { let makeImageBlock = (eA, el, ec) => ({ type: "image", mimeType: eA, data: el, ...ec ? { uri: ec, _meta: { filename: ec } } : {} }); if ("image_blob_ref" === eA.type && eA.blob_path && eA.mime) {
                let el = eA.original_filename || eA.blob_path.split("/").pop() || eA.blob_path;
                return makeImageBlock(eA.mime, this.readBlobAsBase64(eA.blob_path), el);
            } if ("input_image" !== eA.type || !eA.image)
                return; if ("object" == typeof eA.image && "image_blob_ref" === eA.image.type && eA.image.blob_path) {
                let el = eA.image.original_filename || eA.original_filename || eA.image.blob_path.split("/").pop() || eA.image.blob_path;
                return makeImageBlock(eA.image.mime, this.readBlobAsBase64(eA.image.blob_path), el);
            } let el = eA.original_filename; if ("string" == typeof eA.image) {
                let ec = this.parseDataUri(eA.image);
                if (!ec)
                    return;
                return makeImageBlock(ec.mimeType, ec.data, el);
            } if ("object" == typeof eA.image && "string" == typeof eA.image.data)
                return makeImageBlock(eA.image.mediaType || "image/png", eA.image.data, el); }
            static readBlobAsBase64(eA) { try {
                if (eg.existsSync(eA))
                    return eg.readFileSync(eA).toString("base64");
            }
            catch { } return ""; }
            static parseDataUri(eA) { let el = eA.match(/^data:([^;]+);base64,(.+)$/); if (el)
                return { mimeType: el[1], data: el[2] }; }
            static formatUriAsLink(eA, el) { try {
                return (0, ed.encodeAcpResourceLinkToInputText)({ uri: eA, name: el }).text;
            }
            catch {
                return el || eA;
            } }
            static extractBlobIdFromPath(eA) { try {
                let el = eA.lastIndexOf("/");
                if (-1 === el)
                    return;
                let ec = eA.substring(el + 1), eu = ec.lastIndexOf(".");
                return (eu > 0 ? ec.substring(0, eu) : ec) || void 0;
            }
            catch {
                return;
            } }
        };
        AcpUtils.INTERNAL_STREAMING_UPDATES = new Set(["tool_call_pending", "tool_call_arguments_delta", "tool_call_arguments_done"]), AcpUtils.SOURCE_EVENT_META_KEY = "codebuddy.ai/sourceEvent";
    } });
