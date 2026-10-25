import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { ServerResponse } from 'node:http';

/** Auxiliary naming shares the provider endpoint, but must never affect execution counts/failure injection. */
export function replyToFixtureTitle(body: any, res: ServerResponse): boolean {
  const system = (body.messages ?? []).filter((m: any) => m.role === 'system' || m.role === 'developer').map((m: any) => m.content).join('\n');
  if (!system.includes('为会话生成简明标题')) {
    assert.ok(body.tools?.length, 'unexpected model request source: execution must declare tools');
    return false;
  }
  assert.ok(system.startsWith('根据首条用户需求及模型已经输出的有效正文，'), 'unexpected title request source');
  assert.ok(!body.tools?.length, 'title request must not declare execution tools');
  const material = JSON.parse(body.messages.findLast((m: any) => m.role === 'user').content);
  assert.deepEqual(Object.keys(material).sort(), ['assistantBodies', 'firstUser']);
  assert.equal(typeof material.firstUser, 'string');
  assert.ok(material.firstUser.length && Array.isArray(material.assistantBodies) && material.assistantBodies.length && material.assistantBodies.every((text: unknown) => typeof text === 'string'), 'title must carry conversation evidence');
  res.writeHead(200, { 'Content-Type': 'text/event-stream' });
  for (const [delta, finish_reason] of [[{ role: 'assistant', content: '测试标题' }, null], [{}, 'stop']]) {
    res.write(`data: ${JSON.stringify({ id: randomUUID(), object: 'chat.completion.chunk', created: 1, model: 'fixture', choices: [{ index: 0, delta, finish_reason }] })}\n\n`);
  }
  res.end('data: [DONE]\n\n');
  return true;
}
