import catalog from "./font-catalog.json" with { type: "json" };
import { formatFontCatalog } from "./format-font-catalog.js";

// Build-time / Node catalog checks. Browser UI fetches the versioned JSON on demand.
export const fontCatalogCommit = catalog.googleFontsCommit;
export const onlineFonts = formatFontCatalog(catalog);
