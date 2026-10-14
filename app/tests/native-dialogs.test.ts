import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import test from "node:test";
import ts from "typescript";

test("product client does not use unstyled browser alert/confirm/prompt", () => {
  const violations: string[] = [];
  const names = new Set(["alert", "confirm", "prompt"]);
  const scan = (directory: string) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) { scan(path); continue; }
      if (!/\.[jt]sx?$/.test(entry.name)) continue;
      const file = ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true);
      const visit = (node: ts.Node) => {
        if (ts.isCallExpression(node)) {
          const target = node.expression;
          const name = ts.isIdentifier(target) ? target.text
            : ts.isPropertyAccessExpression(target) && /^(window|globalThis|self)$/.test(target.expression.getText(file)) ? target.name.text
            : ts.isElementAccessExpression(target) && /^(window|globalThis|self)$/.test(target.expression.getText(file)) && target.argumentExpression && ts.isStringLiteral(target.argumentExpression) ? target.argumentExpression.text : "";
          if (names.has(name)) violations.push(`${path}:${file.getLineAndCharacterOfPosition(node.getStart()).line + 1}: ${name}`);
        }
        ts.forEachChild(node, visit);
      };
      visit(file);
    }
  };
  scan(fileURLToPath(new URL("../src/client", import.meta.url)));
  assert.deepEqual(violations, [], "Use the styled application dialog rather than blocking browser dialogs");
});
