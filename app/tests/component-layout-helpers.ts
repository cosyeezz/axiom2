import assert from "node:assert/strict";
import type { Locator } from "playwright";

/** Reveal a card's own operations: pointer hover over its own header (never a descendant's). */
export async function ensureComponentActions(card: Locator) {
  await card.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  const group = card.locator(":scope > .maintenance-panel-heading .component-actions");
  if (await group.count()) {
    await card.locator(":scope > .maintenance-panel-heading h3").hover();
    await group.waitFor({ state: "visible" });
    await card.page().waitForFunction(node => getComputedStyle(node!).opacity === "1", await group.elementHandle());
  }
  return group;
}

type Box = { left: number; right: number; top: number; bottom: number; width: number; height: number };
/** Own-card geometry: kind glyph spans name/path; operations follow the name; versions last. */
export async function assertComponentHeader(card: Locator) {
  await card.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  const geometry = await card.evaluate(node => {
    // No named inner functions: tsx keepNames would inject an undefined __name helper into the page.
    const selectors = [".maintenance-panel-heading", "h3", ".component-card-version", ".component-actions", ".component-card-description", ".component-card-notes", ".component-card-location", ".component-card-versions", ".component-card-identity", ".maintenance-resource-icon", ".component-card-candidate"];
    const elements = selectors.map(selector => [...node.querySelectorAll<HTMLElement>(selector)].find(element => element.closest(".component-card") === node));
    const boxes = elements.map(element => {
      if (!element || getComputedStyle(element).visibility === "hidden" || !element.getBoundingClientRect().width) return null;
      const box = element.getBoundingClientRect();
      return { left: box.left, right: box.right, top: box.top, bottom: box.bottom, width: box.width, height: box.height };
    });
    const header = node.querySelector<HTMLElement>(":scope > .maintenance-panel-heading")!;
    const icon = elements[9], versionsElement = elements[7];
    const buttons = [...header.querySelectorAll<HTMLButtonElement>(".component-actions > .component-action")];
    const iconStyle = icon && getComputedStyle(icon);
    const cardStyle = getComputedStyle(node);
    const frame = ["top", "right", "bottom", "left"].map(side => ({ width: cardStyle.getPropertyValue(`border-${side}-width`), style: cardStyle.getPropertyValue(`border-${side}-style`), color: cardStyle.getPropertyValue(`border-${side}-color`) }));
    return { boxes, label: node.getAttribute("aria-label"), frame,
      legacyDisclosure: header.querySelectorAll(".component-operations-toggle,.component-toolbar").length,
      versionsLast: header.lastElementChild?.classList.contains("component-card-versions") ?? false,
      versionsChildren: [...(versionsElement?.children ?? [])].map(child => child.className),
      versionLabels: [...header.querySelectorAll(".component-version-label")].map(label => label.textContent?.trim()),
      statusInVersions: !!versionsElement?.querySelector(".tag,.component-card-status"),
      pathButtons: [...header.querySelectorAll(".component-card-location button")].map(button => button.getBoundingClientRect().toJSON()),
      iconFrame: iconStyle ? { border: iconStyle.borderTopWidth, background: iconStyle.backgroundColor, padding: iconStyle.paddingTop } : null,
      glyph: icon?.querySelector("svg")?.getBoundingClientRect().toJSON(),
      environmentGlyph: node.parentElement?.closest(".component-environment")?.querySelector(":scope > .component-environment-heading > svg")?.getBoundingClientRect().toJSON(),
      nameFont: parseFloat(getComputedStyle(header.querySelector("h3")!).fontSize),
      actionButtons: buttons.map(button => ({ disabled: button.disabled, display: getComputedStyle(button).display, box: button.getBoundingClientRect().toJSON(), glyph: button.querySelector("svg")!.getBoundingClientRect().toJSON(), padding: getComputedStyle(button).paddingTop, background: getComputedStyle(button).backgroundColor, border: getComputedStyle(button).borderTopWidth })),
      overflow: header.scrollWidth > header.clientWidth + 1,
      questionCount: header.querySelectorAll(".component-details-toggle").length };
  });
  const [heading, title, version, actions, description, notes, location, versions, identity, icon, candidate] = geometry.boxes as (Box | null)[];
  const evidence = JSON.stringify(geometry);
  if (!heading || !title) await card.page().screenshot({ path: `${process.env.AXIOM_TEST_ARTIFACTS ?? "test-results"}/header-failure.png`, fullPage: true });
  assert.ok(heading && title && identity && icon, `a visible card has a measurable header, type glyph and name: ${evidence}`);
  assert.ok(parseFloat(geometry.frame[0].width) > 0 && geometry.frame[0].style === "solid", `a card has a visible enclosing border: ${evidence}`);
  for (const edge of geometry.frame.slice(1)) assert.deepEqual(edge, geometry.frame[0], `all four card edges have the same width, style and color: ${evidence}`);
  assert.equal(geometry.questionCount, 0, "no question-mark details control");
  assert.equal(geometry.legacyDisclosure, 0, "operations never fold into a separate operations strip");
  assert.equal(geometry.overflow, false, `the header itself must not overflow: ${evidence}`);
  assert.deepEqual(geometry.iconFrame && { border: geometry.iconFrame.border, background: geometry.iconFrame.background, padding: geometry.iconFrame.padding }, { border: "0px", background: "rgba(0, 0, 0, 0)", padding: "0px" }, `type glyph has no frame or padding: ${evidence}`);
  assert.ok(geometry.glyph && Math.abs(geometry.glyph.width - icon.width) <= .5 && Math.abs(geometry.glyph.height - icon.height) <= .5 && Math.abs(geometry.glyph.width - geometry.glyph.height) <= .5, `type glyph fills a square slot without stretching: ${evidence}`);
  const center = (box: Box) => (box.top + box.bottom) / 2;
  for (const box of [identity, title, location, actions, versions].filter(Boolean) as Box[]) {
    assert.ok(box.width > 0 && box.height > 0 && box.left >= heading.left - 1 && box.right <= heading.right + 1 && box.top >= heading.top - 1 && box.bottom <= heading.bottom + 1, `visible own-header items remain enclosed: ${evidence}`);
  }
  assert.ok(icon.right < title.left, "type glyph precedes the name");
  if (geometry.environmentGlyph) {
    assert.equal(geometry.environmentGlyph.width, 16, `the environment heading remains the 16px reference: ${evidence}`);
    assert.equal(icon.width, geometry.environmentGlyph.width, `nested type glyph size follows the group heading: ${evidence}`);
    assert.equal(icon.height, geometry.environmentGlyph.height, `nested type glyph remains square like the group heading: ${evidence}`);
    assert.ok(Math.abs(center(icon) - center(title)) <= 1, `nested type glyph aligns with its name row: ${evidence}`);
  }
  if (location) {
    assert.ok(location.top - title.bottom >= 1 && location.top - title.bottom <= 3, `path is below the name with a compact two-pixel gap: ${evidence}`);
    assert.ok(Math.abs(location.left - title.left) <= 1, `path starts at the name's left edge: ${evidence}`);
    if (!geometry.environmentGlyph) assert.ok(icon.top <= title.bottom - 2 && icon.bottom >= location.top + 2, `outer type glyph spans the name and path rows: ${evidence}`);
    for (const button of geometry.pathButtons) assert.ok(button.width > 0 && button.left >= location.left - 1 && button.right <= location.right + 1 && button.top >= heading.top - 1 && button.bottom <= heading.bottom + 1, `copy/open controls are not clipped: ${evidence}`);
  }
  const shown = geometry.actionButtons.filter(button => button.display !== "none");
  assert.ok(geometry.actionButtons.every(button => !button.disabled || button.display === "none"), `unavailable operations are hidden, not shown disabled: ${evidence}`);
  if (actions && shown.length) {
    assert.ok(Math.abs(center(actions) - center(title)) <= 1.5, `operations share the name's row: ${evidence}`);
    assert.ok(actions.left - title.right >= 3 && actions.left - title.right <= 10, `operations immediately follow the name: ${evidence}`);
    const size = shown[0].box.width;
    for (const button of shown) {
      assert.ok(Math.abs(button.box.width - size) <= .5 && Math.abs(button.box.height - size) <= .5, `operations have one uniform square size: ${evidence}`);
      assert.ok(Math.abs(button.glyph.width - button.box.width) <= .5 && Math.abs(button.glyph.height - button.box.height) <= .5 && button.padding === "0px" && button.border === "0px", `visible glyph size is the real control size: ${evidence}`);
      assert.ok(size >= geometry.nameFont * .95 && size <= geometry.nameFont * 1.2, `operation size derives from the name font: ${evidence}`);
    }
    const gaps = shown.slice(1).map((button, index) => button.box.left - shown[index].box.right);
    assert.ok(gaps.every(gap => Math.abs(gap - gaps[0]) <= .5), `operations have uniform spacing: ${evidence}`);
  }
  if (versions) {
    assert.ok(geometry.versionsLast, "versions are the final header item in DOM and reading order");
    assert.equal(geometry.statusInVersions, false, "status labels never occupy the version slot");
    assert.ok(geometry.versionLabels.every(label => label === "当前" || label === "推荐" || label === "最新"), `version labels use two characters: ${evidence}`);
    assert.ok(geometry.versionsChildren.every(name => ["component-card-version", "component-card-candidate"].includes(name)), `versions show only current then latest/recommended: ${evidence}`);
    if (version && candidate) {
      if (versions.top < identity.bottom - 1 && versions.left > identity.right - 1) {
        assert.ok(Math.abs(versions.right - heading.right) <= 1, "side versions finish at the header's trailing edge");
        assert.ok(candidate.top >= version.bottom - .5, "current version is above the candidate");
      } else {
        assert.ok(Math.abs(version.left - title.left) <= 1, `wrapped versions align with the name's left edge: ${evidence}`);
        assert.ok(Math.abs(center(version) - center(candidate)) <= 1 || candidate.top >= version.bottom - .5, `wrapped versions share one row when they fit: ${evidence}`);
        assert.ok(versions.top >= identity.bottom - 1, "wrapped versions are the final header row");
      }
    }
  }
  if (description) assert.ok(description.top >= heading.bottom - 1, "description follows the complete header");
  if (notes) assert.ok(notes.top >= heading.bottom - 1, "necessary notes are inline and visible by default");
  return { ...geometry, heading, title, version, actions, description, notes, location, versions, icon };
}

/** Pointer palette: hidden until the card is hovered, grey on card hover, lit only on the icon. */
export async function assertComponentPalette(card: Locator) {
  const page = card.page();
  await page.mouse.move(0, 0);
  await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
  const group = card.locator(":scope > .maintenance-panel-heading .component-actions");
  await page.waitForFunction(node => getComputedStyle(node!).opacity === "0", await group.elementHandle());
  await ensureComponentActions(card);
  const palette = await card.evaluate(node => {
    const probe = document.createElement("span"); node.appendChild(probe);
    probe.style.color = "var(--muted)"; const muted = getComputedStyle(probe).color;
    probe.style.color = "var(--fg)"; const foreground = getComputedStyle(probe).color;
    probe.style.color = "var(--danger-text)"; const danger = getComputedStyle(probe).color;
    probe.remove();
    return { muted, foreground, danger };
  });
  const buttons = card.locator(":scope > .maintenance-panel-heading .component-action:not(:disabled)");
  assert.ok(await buttons.count() >= 4, "the palette check covers real ordinary, primary and danger actions");
  for (const button of await buttons.all()) {
    await card.locator(":scope > .maintenance-panel-heading h3").hover();
    assert.equal(await button.isVisible(), true);
    assert.equal(await button.locator("svg").evaluate(node => getComputedStyle(node).color), palette.muted, "card hover shows operations in grey");
    assert.equal(await button.evaluate(node => getComputedStyle(node).backgroundColor), "rgba(0, 0, 0, 0)");
    await button.hover();
    const danger = await button.evaluate(node => node.classList.contains("is-danger"));
    assert.equal(await button.locator("svg").evaluate(node => getComputedStyle(node).color), danger ? palette.danger : palette.foreground, "only the pointed icon lights up");
    assert.equal(await button.evaluate(node => getComputedStyle(node).backgroundColor), "rgba(0, 0, 0, 0)", "no background ring on hover");
  }
  await page.mouse.move(0, 0);
}

/** Every recursive level has equal name size and clear enclosing boundaries. */
export async function assertComponentTree(root: Locator) {
  for (const card of [root, ...await root.locator(".component-card").all()]) {
    await assertComponentHeader(card);
    const relationship = await card.evaluate(node => {
      const parent = node.parentElement?.closest(".component-card");
      const box = node.getBoundingClientRect(), parentBox = parent?.getBoundingClientRect();
      const title = node.querySelector(":scope > .maintenance-panel-heading h3")!;
      return { left: box.left, right: box.right, parentLeft: parentBox?.left, parentRight: parentBox?.right,
        overview: node.matches(".updates-simple > .component-card"), border: parseFloat(getComputedStyle(node).borderTopWidth), font: getComputedStyle(title).fontSize,
        parentFont: parent && getComputedStyle(parent.querySelector(":scope > .maintenance-panel-heading h3")!).fontSize };
    });
    if (relationship.parentLeft !== undefined) {
      assert.ok(relationship.left >= relationship.parentLeft + 10 && relationship.right <= relationship.parentRight! - 10);
      assert.equal(relationship.font, relationship.parentFont, "recursive cards use the same name size");
      assert.equal(relationship.border, 1, "internal cards use a lighter one-pixel enclosure");
    } else assert.equal(relationship.border, relationship.overview ? 1 : 2, relationship.overview ? "the connection overview has a lighter one-pixel enclosure" : "the outer scope has a distinct complete two-pixel frame");
  }
}
