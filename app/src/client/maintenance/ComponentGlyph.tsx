import { Icon } from "../Icon.js";
import glyphs from "./component-glyphs.json" with { type: "json" };
import originalNotices from "./component-glyphs-LICENSE.txt?raw";
import actionNotices from "./component-action-glyphs-LICENSE.txt?raw";
const licenseNotices = `${originalNotices}\n\n${actionNotices}`;

export type ComponentGlyphName = keyof typeof glyphs;
export type ComponentKind = "component" | "environment" | "skill" | "mcp" | "dependency";
const kindSymbols = { environment: "square-terminal", skill: "book-open-check", mcp: "tool-tool", dependency: "package" } as const;

/** Explicit presentation types, independent of installation ownership or dependency direction. */
export function ComponentKindGlyph({ kind }: { kind: ComponentKind }) {
  if (kind === "component") return <ComponentGlyph name="component" />;
  return <svg className="ui-glyph component-kind-glyph" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" data-component-kind={kind}>
    <metadata>{licenseNotices}</metadata>
    <use href={`#i-${kindSymbols[kind]}`} />
  </svg>;
}

/** Existing action names stay local to this card; unrelated UI icons do not change. */
const actionGlyphs: Readonly<Record<string, ComponentGlyphName>> = {
  "refresh-cw": "check",
  download: "install",
  package: "install",
  "arrow-up-to-line": "update",
  "rotate-cw": "reinstall",
  "trash-2": "uninstall",
  "cleanup-package": "cleanup-package",
  "download-package": "download-package",
  "install-cached": "install-cached",
  "open-installer": "open-installer",
  "switch-version": "switch-version",
  repair: "repair",
};

/** Trusted, checked-in SVG geometry. Fitted viewBoxes include the visible strokes,
 * not just path bounds; per-shape optical corrections preserve aspect ratio.
 * Source hashes, authors, full licenses and modification notice accompany the data.
 */
export function ComponentGlyph({ name }: { name: ComponentGlyphName }) {
  const glyph = glyphs[name];
  return <svg className="ui-glyph component-glyph" width="16" height="16" viewBox={glyph.viewBox} preserveAspectRatio="xMidYMid meet" aria-hidden="true" focusable="false" data-component-glyph={name} data-icon-source={glyph.id}>
    {name === "component" && <metadata>{licenseNotices}</metadata>}
    <g dangerouslySetInnerHTML={{ __html: glyph.body }} />
  </svg>;
}

export function ComponentActionGlyph({ name }: { name: string }) {
  const selected = actionGlyphs[name];
  return selected ? <ComponentGlyph name={selected} /> : <Icon name={name} />;
}
