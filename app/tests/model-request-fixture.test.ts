import test from 'node:test';
import assert from 'node:assert/strict';
import type { ServerResponse } from 'node:http';
import { replyToFixtureTitle } from './model-request-fixture.js';

function fixture() {
  const chunks: string[] = [];
  const response = { writeHead: (...args: unknown[]) => chunks.push(JSON.stringify(args)), write: (data: string) => chunks.push(data), end: (data: string) => chunks.push(data) } as unknown as ServerResponse;
  const body = { messages: [{ role: 'system', content: '根据首条用户需求及模型已经输出的有效正文，为会话生成简明标题。' }, { role: 'user', content: JSON.stringify({ firstUser: 'run fixture', assistantBodies: ['result'] }) }] };
  return { chunks, response, body };
}
test('fixture replies to proven title evidence without consuming execution logic', () => {
  const { chunks, response, body } = fixture();
  assert.equal(replyToFixtureTitle(body, response), true);
  assert.match(chunks.join(''), /测试标题/); assert.match(chunks.at(-1)!, /\[DONE\]/);
});
test('fixture leaves actual execution responses and counters alone', () => {
  const { chunks, response } = fixture();
  assert.equal(replyToFixtureTitle({ messages: [{ role: 'user', content: '为会话生成简明标题' }], tools: [{ type: 'function' }] }, response), false);
  assert.equal(chunks.length, 0);
});
test('fixture rejects unknown no-tool requests and malformed or mixed title evidence', () => {
  const { response, body } = fixture();
  assert.throws(() => replyToFixtureTitle({ messages: [] }, response));
  assert.throws(() => replyToFixtureTitle({ ...body, tools: [{}] }, response));
  assert.throws(() => replyToFixtureTitle({ messages: [{ role: 'system', content: 'unrelated 为会话生成简明标题' }] }, response));
  const invalid = structuredClone(body); invalid.messages[1].content = JSON.stringify({ firstUser: 'run', assistantBodies: [] });
  assert.throws(() => replyToFixtureTitle(invalid, response));
});
