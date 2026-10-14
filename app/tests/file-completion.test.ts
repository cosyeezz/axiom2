import assert from "node:assert/strict";
import { test } from "node:test";
import { atFileToken, insertFileSuggestion } from "../src/client/chat/file-completion.js";

test("@ detection accepts paths and open quotes, but not emails or completed tokens", () => {
  for (const text of ["@", "@src/", "Inspect @read", "Inspect\n@read", 'Inspect @"space name', "（@中文", "[@src"])
    assert.equal(atFileToken(text, text.length), true, JSON.stringify(text));
  for (const text of ["", "hello", "dev@example.com", "@@src", "@src ", '@"finished"', '@"line\nbreak'])
    assert.equal(atFileToken(text, text.length), false, JSON.stringify(text));
  assert.equal(atFileToken("Inspect @src trailing", 12), true, "only text before the cursor participates");
});

test("file insertion replaces only the matching prefix and preserves surrounding text", () => {
  const text = "Inspect @rea then explain";
  assert.deepEqual(insertFileSuggestion(text, 12, "@rea", { label: "readme.md", value: "@readme.md" }), {
    text: "Inspect @readme.md  then explain", cursor: 19,
  });
  assert.equal(insertFileSuggestion(text, 12, "@other", { label: "x", value: "@x" }), null);
  assert.equal(insertFileSuggestion(text, 12, "rea", { label: "x", value: "@x" }), null);
});

test("quoted insertion consumes a pre-existing closing quote, and folders keep the cursor inside quotes", () => {
  assert.deepEqual(insertFileSuggestion('@"space" tail', 7, '@"space', {
    label: "space name.txt", value: '@"space name.txt"',
  }), { text: '@"space name.txt"  tail', cursor: 18 });
  assert.deepEqual(insertFileSuggestion("@fold", 5, "@fold", {
    label: "folder/", value: "@folder/",
  }), { text: "@folder/", cursor: 8 });
  assert.deepEqual(insertFileSuggestion("@space", 6, "@space", {
    label: "space folder/", value: '@"space folder/"',
  }), { text: '@"space folder/"', cursor: 15 });
});
