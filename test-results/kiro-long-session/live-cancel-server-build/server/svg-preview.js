/** Conservative static SVG subset for image-only previews, never inline HTML. */
const elements = new Set(["svg", "g", "path", "rect", "circle", "ellipse", "line", "polyline", "polygon", "text", "tspan", "title", "desc", "defs", "clipPath", "linearGradient", "radialGradient", "stop"]);
const attributes = new Set(["xmlns", "viewBox", "width", "height", "x", "y", "x1", "y1", "x2", "y2", "cx", "cy", "r", "rx", "ry", "d", "points", "fill", "stroke", "stroke-width", "stroke-linecap", "stroke-linejoin", "stroke-dasharray", "stroke-dashoffset", "stroke-miterlimit", "fill-rule", "clip-rule", "opacity", "fill-opacity", "stroke-opacity", "transform", "id", "clip-path", "preserveAspectRatio", "font-family", "font-size", "font-weight", "text-anchor", "dominant-baseline", "dx", "dy", "offset", "stop-color", "stop-opacity", "gradientUnits", "gradientTransform", "spreadMethod", "fx", "fy", "fr", "color", "role", "aria-label", "aria-hidden"]);
export function staticSvg(bytes) {
    if (!bytes.length || bytes.length > 1024 * 1024)
        return false;
    let source;
    try {
        source = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    }
    catch {
        return false;
    }
    source = source.replace(/^\uFEFF/, "").trim();
    if (source.startsWith("<?xml"))
        source = source.replace(/^<\?xml\s+version=["']1\.0["'](?:\s+encoding=["']UTF-8["'])?\s*\?>\s*/i, "");
    if (!source.startsWith("<svg") || /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(source))
        return false;
    // Reject declarations/entities, comments, processing instructions and raw markup in text.
    // A small explicit grammar is deliberately stricter than general XML/SVG.
    const stack = [];
    let position = 0, roots = 0;
    while (position < source.length) {
        if (source[position] !== "<") {
            const end = source.indexOf("<", position), text = source.slice(position, end < 0 ? source.length : end);
            if (/&(?!(?:amp|lt|gt|quot|apos);)/.test(text) || (!stack.length && text.trim()))
                return false;
            position += text.length;
            continue;
        }
        const tag = /^<(\/?)([A-Za-z][A-Za-z0-9]*)([^<>]*?)(\/?)>/.exec(source.slice(position));
        if (!tag || !elements.has(tag[2]))
            return false;
        const [, closing, name, raw, selfClosing] = tag;
        if (closing) {
            if (raw.trim() || selfClosing || stack.pop() !== name)
                return false;
        }
        else {
            if (!stack.length && (name !== "svg" || ++roots !== 1))
                return false;
            let rest = raw;
            const seen = new Set();
            while (rest.trim()) {
                const attr = /^\s+([A-Za-z][A-Za-z0-9:-]*)\s*=\s*(?:"([^"<>]*)"|'([^'<>]*)')/.exec(rest);
                if (!attr || !attributes.has(attr[1]) || seen.has(attr[1]))
                    return false;
                const value = attr[2] ?? attr[3];
                if (/[&\\]/.test(value) || /(?:url\s*\(|:)/i.test(value) && !(attr[1] === "xmlns" && value === "http://www.w3.org/2000/svg") && !/^url\(#[A-Za-z][\w-]*\)$/.test(value))
                    return false;
                if (attr[1] === "xmlns" && value !== "http://www.w3.org/2000/svg")
                    return false;
                seen.add(attr[1]);
                rest = rest.slice(attr[0].length);
            }
            if (!selfClosing)
                stack.push(name);
        }
        position += tag[0].length;
    }
    return roots === 1 && stack.length === 0;
}
//# sourceMappingURL=svg-preview.js.map