import assert from "node:assert/strict";
import type { Locator, Page } from "playwright";

export async function chooseSelect(page: Page, trigger: Locator, value: string) {
  await trigger.click();
  const option = page.getByRole("listbox").locator('[role="option"]');
  const index = await option.evaluateAll((nodes, selected) => nodes.findIndex(node => node.getAttribute("data-value") === selected), value);
  assert.ok(index >= 0, `missing option ${value}`);
  await option.nth(index).click();
}

export async function assertSelectPosition(page: Page, trigger: Locator) {
  const menu = page.getByRole("listbox");
  await menu.waitFor();
  const anchor = await trigger.boundingBox(), box = await menu.boundingBox();
  const viewport = page.viewportSize()!;
  assert.ok(anchor && box);
  assert.ok(box.x >= 11 && box.x + box.width <= viewport.width - 11, "menu stays within horizontal viewport gutters");
  assert.ok(box.y >= 11 && box.y + box.height <= viewport.height - 11, "menu stays within vertical viewport gutters");
  assert.ok(box.y >= anchor.y + anchor.height + 6 || box.y + box.height <= anchor.y - 6, "menu does not overlap its trigger");
  assert.ok(Math.abs(box.width - Math.min(anchor.width, 640, viewport.width - 24)) <= 1, "menu matches trigger width within viewport");
  assert.ok(await menu.evaluate(node => node.scrollWidth <= node.clientWidth + 1), "options do not overflow horizontally");
  assert.ok(await menu.evaluate(node => { const r = node.getBoundingClientRect(); return node.contains(document.elementFromPoint(r.x + r.width / 2, r.y + Math.min(20, r.height / 2))); }), "menu is above surrounding content");
}
