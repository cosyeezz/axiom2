(async () => {
  const base = globalThis.__live06;
  if (!base || base.baseline.length !== 30) throw Error('baseline-unavailable');
  const all = await (await fetch('/flows')).json();
  const fresh = all.filter(f => !base.baseline.includes(f.id)).sort((a,b) => a.request.timestamp_start - b.request.timestamp_start);
  const runs = ['eee14cee-b8a5-42c7-8c1b-1d3943032b73', '81b7c697-cd99-40fe-bf5e-170f0ec12614'];
  const markers = ['AXIOM_KIRO_CONTINUATION_06_91e7a2c4', 'AXIOM_KIRO_NEXT_RUN_06_6b4d29a1'];
  const fixtures = '/tmp/axiom-kiro-responses-live-06.txt';
  const rows = [], main = [];
  for (const f of fresh) {
    const h = new Map(f.request.headers.map(([k,v]) => [k.toLowerCase(),v]));
    const row = { id:f.id, method:f.request.method, inference:f.request.path === '/v1/responses', http:f.request.http_version, status:f.response?.status_code ?? null };
    if (!row.inference) { row.authRefresh = f.request.path === '/refreshToken'; rows.push(row); continue; }
    const raw = await (await fetch(`/flows/${f.id}/request/content.data`)).text();
    let body; try { body = JSON.parse(raw); } catch { row.requestParseFailed=true; rows.push(row); continue; }
    const response = await (await fetch(`/flows/${f.id}/response/content.data`)).text();
    const events = []; let unparsed = 0;
    for (const block of response.split(/\r?\n\r?\n/)) {
      const data = block.split(/\r?\n/).filter(l => l.startsWith('data:')).map(l => l.slice(5).trimStart()).join('\n');
      if (!data || data === '[DONE]') continue;
      try { events.push(JSON.parse(data)); } catch { unparsed++; }
    }
    const terminal = events.find(e => e.type === 'response.completed')?.response;
    const streamText = events.filter(e => e.type === 'response.output_text.delta').map(e => e.delta ?? '').join('');
    const outputCalls = (terminal?.output ?? []).filter(i => i.type === 'function_call');
    if (!outputCalls.length) outputCalls.push(...events.filter(e => e.type === 'response.output_item.done' && e.item?.type === 'function_call').map(e => e.item));
    const metadata = body.metadata ?? {}, input = Array.isArray(body.input) ? body.input : [];
    const calls = input.filter(i => i.type === 'function_call'), results = input.filter(i => i.type === 'function_call_output');
    const continuation = metadata['kiro:agent_continuation_id'];
    const names = [...h.keys()].sort();
    Object.assign(row, {
      path:'/v1/responses', model:body.model, tools:body.tools?.length ?? 0, inputCount:input.length,
      metadataKeys:Object.keys(metadata).sort(), continuationPresent:typeof continuation === 'string',
      continuationUuidV4:/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(continuation ?? ''),
      continuationMatchesRuns:runs.map(r => r === continuation),
      rootEqualsConversation:metadata['kiro:conversation_id'] === metadata['kiro:root_conversation_id'],
      conversationPresent:typeof metadata['kiro:conversation_id'] === 'string' && metadata['kiro:conversation_id'].length > 0,
      continuationDiffersConversation:typeof continuation === 'string' && continuation !== metadata['kiro:conversation_id'],
      uaEqualsOfficial:h.get('user-agent') === base.officialUa, connectionEqualsOfficial:h.get('connection') === base.officialConnection,
      headerNames:names, extraHeaders:names.filter(n => !base.officialHeaderNames.includes(n)), missingHeaders:base.officialHeaderNames.filter(n => !names.includes(n)),
      bodyLengthMatches:Number(h.get('content-length')) === new TextEncoder().encode(raw).byteLength,
      profileHeaderMatchesBody:typeof body.profileArn === 'string' && body.profileArn === h.get('x-amzn-kiro-profile'),
      optout:h.get('x-amzn-codewhisperer-optout'), attempt:h.get('x-kiro-attempt'),
      historicalCalls:calls.length, historicalResults:results.length,
      historicalIdsMatch:calls.length === 1 && results.length === 1 && calls[0].call_id === results[0].call_id,
      historicalMarker:results.some(i => typeof i.output === 'string' && i.output.includes(markers[0])),
      fixtureInInput:JSON.stringify(input).includes(fixtures),
      outputCallCount:outputCalls.length, eventCount:events.length, unparsed,
      terminalStatus:terminal?.status ?? null, endsDONE:response.trimEnd().endsWith('data: [DONE]'),
      textEqualsMarkers:markers.map(m => m === streamText),
    });
    rows.push(row);
    if (row.tools > 0) main.push({row, metadata, calls, results, outputCalls});
  }
  const m = main;
  return {baselineCount:base.baseline.length, totalFlowCount:all.length, newFlowCount:fresh.length, flows:rows,
    mainCount:m.length,
    firstTwoSameContinuation:m.length === 3 && m[0].metadata['kiro:agent_continuation_id'] === m[1].metadata['kiro:agent_continuation_id'],
    nextRunDifferent:m.length === 3 && m[1].metadata['kiro:agent_continuation_id'] !== m[2].metadata['kiro:agent_continuation_id'],
    allMainConversationSame:m.length === 3 && m.every(x => x.metadata['kiro:conversation_id'] === m[0].metadata['kiro:conversation_id']),
    allMainRootSame:m.length === 3 && m.every(x => x.metadata['kiro:root_conversation_id'] === m[0].metadata['kiro:root_conversation_id']),
    firstCallMatchesNextHistory:m.length === 3 && m[0].outputCalls.length === 1 && m[1].calls.length === 1 && m[1].results.length === 1 && m[0].outputCalls[0].call_id === m[1].calls[0].call_id && m[1].calls[0].call_id === m[1].results[0].call_id,
    mainRunIdsMatch:m.length === 3 && m[0].row.continuationMatchesRuns[0] && m[1].row.continuationMatchesRuns[0] && m[2].row.continuationMatchesRuns[1]
  };
})()
