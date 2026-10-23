import postcss, { type Plugin } from "postcss";

const dimensions = /^(font|font-size|line-height|letter-spacing|word-spacing|(?:min-|max-)?(?:width|height)|(?:padding|margin|inset)(?:-.+)?|top|right|bottom|left|(?:row-|column-)?gap|flex-basis|grid-template-(?:columns|rows)|border-radius|scroll-padding(?:-.+)?|scroll-margin(?:-.+)?|--(?:text-|thread-text-size|thread-line-height|space-|section-y-|container-|radius-))/;
const colorProperties = /^(?:--|color$|background|border|outline|box-shadow|text-shadow|fill$|stroke$|accent-color$|caret-color$|text-decoration-color$)/;
const colors = /url\([^)]*\)|"[^"\n]*"|'[^'\n]*'|rgba?\([^()]*\)|#[\da-f]{3,8}\b|(?<![\w-])(?:white|black)(?![\w-])/gi;

function colorHex(value: string): string | undefined {
  if (value === "white") return "ffffffff";
  if (value === "black") return "000000ff";
  if (value.startsWith("#")) {
    const hex = value.slice(1).toLowerCase();
    if (hex.length === 3 || hex.length === 4) return hex.split("").map(char => char + char).join("") + (hex.length === 3 ? "ff" : "");
    if (hex.length === 6 || hex.length === 8) return hex + (hex.length === 6 ? "ff" : "");
  }
  if (/^rgba?\(/i.test(value)) {
    const parts = value.slice(value.indexOf("(") + 1, -1).trim().split(/[\s,/]+/);
    if (parts.length < 3 || parts.length > 4 || parts.some(part => !/^\d*\.?\d+%?$/.test(part))) return;
    return [...parts.slice(0, 3).map(part => Math.round(parseFloat(part) * (part.endsWith("%") ? 2.55 : 1))),
      parts[3] === undefined ? 255 : Math.round(parseFloat(parts[3]) * (parts[3].endsWith("%") ? 2.55 : 255))]
      .map(channel => Math.max(0, Math.min(255, channel)).toString(16).padStart(2, "0")).join("");
  }
}

/** Reflow text AND its surrounding geometry. Colors are repainted before text
 * rasterization instead of filtering a composited image of the entire page. */
export function displayTypography(): Plugin {
  return {
    postcssPlugin: "axiom-display-typography",
    prepare() {
      const palette = new Map<string, string>();
      return {
        Declaration(declaration) {
          if (declaration.prop.startsWith("--display-")) return;
          if (dimensions.test(declaration.prop) && !declaration.value.includes("--display-font-scale")) {
            declaration.value = declaration.value.replace(/(-?\d*\.?\d+)(px|vw|vh)\b/g, (match, size: string, unit: string) => {
              if (unit !== "px" && !/^(font|font-size|line-height)$/.test(declaration.prop)) return match;
              // Preserve hairlines and off-screen/accessibility sentinels.
              if (unit === "px" && (Math.abs(Number(size)) <= 2 || Math.abs(Number(size)) >= 9999)) return match;
              return `calc(${size}${unit} * var(--display-font-scale, 1))`;
            });
          }
          if (!colorProperties.test(declaration.prop) || declaration.value.includes("--display-color-")) return;
          declaration.value = declaration.value.replace(colors, value => {
            const hex = colorHex(value.toLowerCase());
            if (!hex) return value;
            const name = `--display-color-${hex}`;
            palette.set(name, `#${hex}`);
            return `var(${name}, ${value})`;
          });
        },
        OnceExit(root) {
          if (!palette.size) return;
          const rule = postcss.rule({ selector: ":root", source: root.source });
          for (const [prop, value] of palette) rule.append(postcss.decl({ prop, value, source: root.source }));
          root.append(rule);
        },
      };
    },
  };
}
