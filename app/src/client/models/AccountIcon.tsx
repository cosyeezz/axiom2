import { Icon } from "../Icon.js";
import { brandMarks } from "./brand-marks.js";
import type { AccountIconChoice } from "./account-icons.js";

/** Renders a brand path (fill) or a shared outline glyph inside the fixed avatar box. */
export function AccountIcon({ choice }: { choice: AccountIconChoice }) {
  const [kind, id] = choice.split(":") as ["brand" | "glyph", string];
  if (kind === "brand") return <svg className="account-brand-mark" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="currentColor" d={brandMarks[id as keyof typeof brandMarks].path} /></svg>;
  return <Icon name={id} />;
}
