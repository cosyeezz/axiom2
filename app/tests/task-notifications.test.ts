import assert from "node:assert/strict";
import { test } from "node:test";
import { Agent } from "@earendil-works/pi-agent-core";
import { AgentSession } from "@earendil-works/pi-coding-agent";
import { queueTaskNotifications } from "../src/server/agents/task-notifications.js";
import { nativeQueuedMessages } from "../src/server/agents/native-queue.js";

function fixture() {
  const agent = new Agent({ streamFn: () => { throw Error("queue-only test must not call a model"); } });
  const session = { agent, isStreaming: true, sessionManager: { getEntries: () => [] },
    sendCustomMessage: AgentSession.prototype.sendCustomMessage } as unknown as AgentSession;
  const submitted = new Set<string>(), persisted = new Set<string>(), events: any[] = [];
  const submit = (ids: string[]) => queueTaskNotifications(session, ids.map(id => ({ id, content: id })), submitted, persisted, () => true, event => events.push(event));
  return { agent, session, submitted, persisted, events, submit };
}

test("notification rejected before enqueue can retry in the same worker without failing successful batch items", async () => {
  const f = fixture(), steer = f.agent.steer.bind(f.agent);
  let reject = true;
  f.agent.steer = message => {
    if ((message as any).details.axiomInput === "two" && reject) throw Error("fixture rejection");
    steer(message);
  };
  await f.submit(["one", "two", "three"]);
  assert.deepEqual([...f.submitted], ["one", "three"]);
  assert.deepEqual(f.events.map(event => [event.type, event.id]), [["input-error", "two"]]);
  reject = false;
  await f.submit(["one", "two", "three"]);
  assert.deepEqual(nativeQueuedMessages(f.session).map((message: any) => message.details.axiomInput), ["one", "three", "two"]);
});

test("notification throwing after enqueue retains its dedupe reservation", async () => {
  const f = fixture(), steer = f.agent.steer.bind(f.agent);
  f.agent.steer = message => { steer(message); throw Error("error after enqueue"); };
  await f.submit(["one", "two"]);
  await f.submit(["one", "two"]);
  assert.equal(nativeQueuedMessages(f.session).length, 2);
  assert.deepEqual(f.events, []);
});

test("unverifiable notification failure stays unknown without duplicate injection", async () => {
  const f = fixture();
  let attempts = 0;
  f.agent.steer = () => { attempts++; throw Error("submission unknown"); };
  (f.agent as any).steeringQueue = undefined;
  await f.submit(["one"]);
  await f.submit(["one"]);
  assert.equal(attempts, 1);
  assert.equal(f.events.length, 1);
  assert.equal(f.events[0].uncertain, true);
});

test("persisted notifications acknowledge again without injection; closed boundaries reject every unsent item", async () => {
  const f = fixture();
  f.persisted.add("saved");
  await queueTaskNotifications(f.session, ["saved", "one", "two"].map(id => ({ id, content: id })), f.submitted, f.persisted, () => false, event => f.events.push(event));
  assert.deepEqual(f.events.map(event => event.type), ["delivered", "input-error", "input-error"]);
  assert.deepEqual(f.events[0].ids, ["saved"]);
  assert.equal(f.agent.peekQueuedMessages().length, 0);
});
