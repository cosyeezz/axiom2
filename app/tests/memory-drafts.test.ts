import assert from "node:assert/strict";
import test from "node:test";
import { clearSubmittedDraft, draftContent, getDraft, updateDraft } from "../src/client/drafts.js";

const scope = () => ({ workspaceId: crypto.randomUUID(), sessionId: crypto.randomUUID() });

test("draft cache retains scoped text, attachments and images without browser storage", () => {
  const owner = scope(), other = { ...owner, workspaceId: crypto.randomUUID() };
  const storage = Object.getOwnPropertyDescriptor(globalThis, "sessionStorage");
  Object.defineProperty(globalThis, "sessionStorage", {
    configurable: true,
    get() { throw Error("drafts must not access browser storage"); },
  });
  try {
    const images = [{ id: "image", name: "large.png", mimeType: "image/png", data: "A".repeat(700_000) }];
    updateDraft(owner, { text: "retain [imag1]", attachments: [{ name: "source.ts", text: "source" }], images });
    assert.equal(getDraft(owner).text, "retain [imag1]");
    assert.deepEqual(getDraft(owner).images, images);
    assert.equal(getDraft(other).text, "");
    assert.deepEqual(getDraft(other).images, []);
    updateDraft(other, { text: "another workspace" });
    assert.equal(getDraft(owner).text, "retain [imag1]");
  } finally {
    if (storage) Object.defineProperty(globalThis, "sessionStorage", storage);
    else Reflect.deleteProperty(globalThis, "sessionStorage");
  }
});

test("successful submission clears only unchanged content in the captured scope", () => {
  const owner = scope(), other = scope();
  updateDraft(owner, { text: "submitted", images: [{ id: "1", name: "a.png", mimeType: "image/png", data: "AQ==" }] });
  updateDraft(other, { text: "another session" });
  const submitted = draftContent(getDraft(owner));
  updateDraft(owner, { text: "typed while awaiting response" });
  clearSubmittedDraft(owner, submitted);
  assert.equal(getDraft(owner).text, "typed while awaiting response");
  clearSubmittedDraft(owner, draftContent(getDraft(owner)));
  assert.deepEqual(draftContent(getDraft(owner)), { text: "", attachment: null, attachments: [], images: [] });
  assert.equal(getDraft(other).text, "another session");
});
