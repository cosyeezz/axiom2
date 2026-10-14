import assert from "node:assert/strict";
import { test } from "node:test";
import { insertImageReferences, nextImageNumber, removeImageReferences } from "../src/client/chat/image-placeholders.js";

test("image references preserve insertion/selection and stable numbering", () => {
  assert.deepEqual(insertImageReferences("前文后文", 2, 2, ["imag1", "imag2"]), {
    text: "前文[imag1] [imag2]后文", cursor: 17,
  });
  assert.deepEqual(insertImageReferences("before REPLACE after", 7, 14, ["imag3"]), {
    text: "before [imag3] after", cursor: 14,
  });
  assert.equal(nextImageNumber("[imag2]", [{ id: "imag4", name: "x", mimeType: "image/png", data: "" }]), 5);
  assert.equal(nextImageNumber("[imag1] [imag3]", []), 4);
  assert.equal(removeImageReferences("a[imag1]b[imag10]c[imag1]", ["imag1"]), "ab[imag10]c");
});
