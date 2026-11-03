'use strict';
const zlib = require('node:zlib');
const MODEL = 'deepseek-v4.1-flash';
const MARKER = 'AXIOM_CODEBUDDY_COMPARE_01';
function decode(bytes, encoding, max = 1048576) {
  if (bytes.length > max) throw Error('BYTE_LIMIT');
  const options = { maxOutputLength: max };
  if (encoding === 'gzip') return zlib.gunzipSync(bytes, options);
  if (encoding === 'deflate') return zlib.inflateSync(bytes, options);
  if (encoding === 'br') return zlib.brotliDecompressSync(bytes, options);
  if (encoding && encoding !== 'identity') throw Error('ENCODING');
  return bytes;
}
function requestProjection(bytes, headers) {
  const body = JSON.parse(decode(bytes, String(headers['content-encoding'] ?? '')).toString('utf8'));
  const messages = Array.isArray(body.messages) ? body.messages : [];
  return { modelMatches: body.model === MODEL, off: body.reasoning_effort === 'none', stream: body.stream === true,
    promptPresent: messages.some(message => message.role === 'user' && JSON.stringify(message.content).includes(`Reply exactly ${MARKER}.`)),
    toolCount: Array.isArray(body.tools) ? body.tools.length : 0, usageRequested: body.stream_options?.include_usage === true,
    roles: messages.map(message => ['system','user','assistant','tool'].includes(message.role) ? message.role : 'other'),
    temperature: typeof body.temperature === 'number' && Number.isFinite(body.temperature) ? body.temperature : null,
    maxTokens: Number.isSafeInteger(body.max_tokens) ? body.max_tokens : null,
    contentEncoding: ['gzip','deflate','br','identity'].includes(headers['content-encoding']) ? headers['content-encoding'] : 'none',
    userAgent: headers['user-agent'] === 'CLI/2.179.0 CodeBuddy/2.179.0' ? headers['user-agent'] : 'other',
    extraVarsPresent: body.extra_vars !== undefined, cacheRetentionPresent: body.cache_retention !== undefined,
    identityHeadersPresent: ['x-conversation-id','x-conversation-request-id','x-request-id','x-conversation-message-id'].every(key => typeof headers[key] === 'string' && headers[key].length > 0),
    invocationEqualsMessage: !!headers['x-request-id'] && headers['x-request-id'] === headers['x-conversation-message-id'],
    requestBytes: bytes.length };
}
function responseProjection(bytes, headers) {
  const text = decode(bytes, String(headers['content-encoding'] ?? ''), 65536).toString('utf8');
  const result = { responseBytes: bytes.length, sse: String(headers['content-type'] ?? '').toLowerCase().startsWith('text/event-stream'), done: false, frames: [], jsonResponse: false };
  let answer='',stopped=false,invalid=false,roleSeen=false,doneCount=0;
  const project = value => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return { object: false };
    const keys = ['id','object','model','choices','usage','code','error','message','msg','data'];
    const out = { keys: keys.filter(key => key in value), modelDeclared: typeof value.model === 'string', modelMatches: value.model === MODEL };
    if (typeof value.model === 'string') out.knownModel = [MODEL,'deepseek-v4-flash','deepseek-v4-pro'].includes(value.model) ? value.model : 'other';
    const error = value.error && typeof value.error === 'object' ? value.error : value;
    const code = error.code;
    if (typeof code === 'number' && Number.isSafeInteger(code) || typeof code === 'string' && /^\d{1,6}$/.test(code)) out.businessCode = Number(code);
    const message = typeof error.message === 'string' ? error.message : typeof error.msg === 'string' ? error.msg : '';
    if (message) out.errorPredicates = { quota: /quota|credit|insufficient|额度/i.test(message), thinking: /reasoning|thinking/i.test(message), maxTokens: /max_tokens|maximum|maxOutput/i.test(message), model: /model|模型/i.test(message) };
    if (Array.isArray(value.choices)) out.choices = value.choices.slice(0,2).map(choice => {
      const delta = choice?.delta;
      return { index: Number.isSafeInteger(choice?.index) ? choice.index : null,
        finish: choice?.finish_reason === null || choice?.finish_reason === undefined ? null : ['stop','tool_calls','length','content_filter','function_call'].includes(choice.finish_reason) ? choice.finish_reason : 'other',
        deltaKeys: delta && typeof delta === 'object' ? ['role','content','reasoning_content','tool_calls','function_call','refusal'].filter(key => key in delta) : [],
        contentLength: typeof delta?.content === 'string' ? delta.content.length : 0,
        contentMarker: typeof delta?.content === 'string' && delta.content.includes(MARKER),
        toolCount: Array.isArray(delta?.tool_calls) ? delta.tool_calls.length : 0 };
    });
    if (value.usage && typeof value.usage === 'object') out.usage = Object.fromEntries(['prompt_tokens','completion_tokens','total_tokens','cached_tokens'].filter(key => Number.isSafeInteger(value.usage[key]) && value.usage[key] >= 0).map(key => [key,value.usage[key]]));
    return out;
  };
  if (!result.sse) { try { result.jsonResponse = true; result.frames.push(project(JSON.parse(text))); } catch { result.invalidJson = true; } return result; }
  for (const frame of text.replace(/\r\n?/g,'\n').split('\n\n')) {
    const data = frame.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
    if (!data) continue;
    if (data === '[DONE]') { result.done = true; doneCount++; if(!stopped||doneCount!==1)invalid=true; continue; }
    if (result.done) invalid=true;
    if (result.frames.length >= 100) throw Error('FRAME_LIMIT');
    try {
      const value=JSON.parse(data);result.frames.push(project(value));
      if(value.error||value.code!==undefined&&value.code!==0&&value.code!=='0'||!Array.isArray(value.choices)||value.choices.length>1)invalid=true;
      for(const choice of value.choices??[]){
        if(choice.index!==0)invalid=true;
        const delta=choice.delta;
        if(delta?.role!==undefined){roleSeen=true;if(delta.role!=='assistant')invalid=true;}
        if(delta?.content!==undefined&&delta.content!==null){if(typeof delta.content!=='string'||stopped)invalid=true;else answer+=delta.content;}
        if(delta?.tool_calls?.length||delta?.function_call||delta?.refusal)invalid=true;
        if(choice.finish_reason!==undefined&&choice.finish_reason!==null){if(choice.finish_reason!=='stop'||stopped)invalid=true;stopped=true;}
      }
    } catch { invalid=true;result.frames.push({ invalidJson: true }); }
  }
  result.assistantRoleDeclared=roleSeen;result.textLength=answer.length;result.exactMarker=answer.trim()===MARKER;
  result.strictTerminal=!invalid&&stopped&&doneCount===1&&result.exactMarker;
  return result;
}
module.exports = { MODEL, MARKER, decode, requestProjection, responseProjection };
