/** CSS url() and @import dependencies; comments and quoted prose are inert. */
export function cssResourceTags(css) {
    const tags = [];
    const tokens = /\/\*[\s\S]*?(?:\*\/|$)|@import\s+(?:"([^"\\]*)"|'([^'\\]*)'|url\(\s*(?:"([^"\\]*)"|'([^'\\]*)'|([^\s"'()\\]*))\s*\))|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|url\(\s*(?:"([^"\\]*)"|'([^'\\]*)'|([^\s"'()\\]*))\s*\)/gi;
    for (const token of css.matchAll(tokens)) {
        const imported = /^@import/i.test(token[0]);
        const href = token.slice(1).find(value => value !== undefined);
        if (!href || href.startsWith("#") || /^(?:data|blob):/i.test(href))
            continue;
        tags.push({ href, kind: imported ? "style" : /\.(?:woff2?|ttf|otf)(?:[?#]|$)/i.test(href) ? "font" : "image", start: token.index + (imported ? token[0].match(/^@import\s+/i)[0].length : 0), end: token.index + token[0].length });
    }
    return tags;
}
function attributeValue(value) {
    const named = { amp: "&", AMP: "&", quot: '"', QUOT: '"', apos: "'", lt: "<", LT: "<", gt: ">", GT: ">", colon: ":", sol: "/", bsol: "\\", period: ".", Tab: "\t", NewLine: "\n" };
    return value.replace(/&(#x[\da-f]+;?|#\d+;?|[a-z]+;)/gi, (entity, key) => {
        if (!key.startsWith("#"))
            return named[key.slice(0, -1)] ?? entity;
        const code = key[1].toLowerCase() === "x" ? parseInt(key.slice(2), 16) : parseInt(key.slice(1), 10);
        return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : "\ufffd";
    });
}
/** HTML entities are decoded before CSS tokenization; map ranges back to the
 * original attribute so replacements cannot break its quotes or nearby text. */
function styleAttributeTags(raw, scan = cssResourceTags) {
    let decoded = "", cursor = 0;
    const starts = [], ends = [];
    const append = (text, start, end) => {
        decoded += text;
        for (let i = 0; i < text.length; i++) {
            starts.push(end === undefined ? start + i : start);
            ends.push(end ?? start + i + 1);
        }
    };
    for (const entity of raw.matchAll(/&(?:#x[\da-f]+;?|#\d+;?|[a-z]+;)/gi)) {
        append(raw.slice(cursor, entity.index), cursor);
        const value = attributeValue(entity[0]);
        append(value, entity.index, value === entity[0] ? undefined : entity.index + entity[0].length);
        cursor = entity.index + entity[0].length;
    }
    append(raw.slice(cursor), cursor);
    return scan(decoded).map(tag => ({ ...tag, inAttribute: true, start: starts[tag.start], end: ends[tag.end - 1] }));
}
/** Srcset URLs may contain commas (notably data URLs); descriptors are separate. */
export function srcsetResourceTags(value) {
    const result = [];
    let at = 0;
    while (at < value.length) {
        while (/[\s,]/.test(value[at] ?? "") && at < value.length)
            at++;
        const start = at;
        while (at < value.length && !/\s/.test(value[at]))
            at++;
        let end = at;
        while (end > start && value[end - 1] === ",")
            end--;
        let descriptor = "";
        if (end === at) {
            const from = at;
            let depth = 0;
            while (at < value.length && (value[at] !== "," || depth)) {
                if (value[at] === "(")
                    depth++;
                if (value[at] === ")")
                    depth = Math.max(0, depth - 1);
                at++;
            }
            descriptor = value.slice(from, at).trim();
            if (value[at] === ",")
                at++;
        }
        const href = value.slice(start, end);
        if (href && !/^(?:data|blob):/i.test(href) && !href.startsWith("#") && (!descriptor || /^(?:[1-9]\d*w|(?:\d+(?:\.\d+)?|\.\d+)x)$/.test(descriptor)))
            result.push({ href, kind: "image", start, end, urlOnly: true });
    }
    return result;
}
/** Source ranges let the client replace only actual resource attributes, without
 * serializing the document or changing tag-like strings in scripts/text areas. */
export function htmlResourceTags(html, runtime) {
    const result = [];
    const tags = /<!--[\s\S]*?(?:-->|$)|<![^>]*>|<\/?([a-z][a-z\d:-]*)\b((?:[^>"']|"[^"]*"|'[^']*')*)>/gi;
    let tag, templates = 0;
    while ((tag = tags.exec(html))) {
        if (!tag[1])
            continue;
        const name = tag[1].toLowerCase(), closing = tag[0].startsWith("</");
        if (name === "template")
            templates = Math.max(0, templates + (closing ? -1 : 1));
        if (closing)
            continue;
        if (name === "plaintext")
            break;
        let scriptRange;
        if (/^(script|style|textarea|title|xmp|iframe|noembed|noframes|noscript)$/.test(name)) {
            const end = new RegExp(`</${name}(?=[\\s/>])[^>]*>`, "gi");
            end.lastIndex = tags.lastIndex;
            const close = end.exec(html);
            if (name === "script" && !templates)
                scriptRange = { start: tags.lastIndex, end: close?.index ?? html.length, type: "" };
            if (name === "style" && !templates) {
                for (const resource of cssResourceTags(html.slice(tags.lastIndex, close?.index ?? html.length)))
                    result.push({ ...resource, start: resource.start + tags.lastIndex, end: resource.end + tags.lastIndex });
            }
            tags.lastIndex = close ? end.lastIndex : html.length;
        }
        if (templates)
            continue;
        const attrs = new Map();
        for (const attr of tag[2].matchAll(/([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)) {
            const key = attr[1].toLowerCase(), start = tag.index + 1 + tag[1].length + attr.index;
            if (attrs.has(key))
                continue;
            const raw = attr[2] ?? attr[3] ?? attr[4] ?? "";
            attrs.set(key, { value: attributeValue(raw), start, end: start + attr[0].length });
            if (key === "style" || (name === "img" || name === "source" || name === "link") && /^(?:srcset|imagesrcset)$/.test(key)) {
                const offset = start + attr[0].length - raw.length - (attr[2] !== undefined || attr[3] !== undefined ? 1 : 0);
                for (const resource of styleAttributeTags(raw, key === "style" ? cssResourceTags : srcsetResourceTags))
                    result.push({ ...resource, start: offset + resource.start, end: offset + resource.end });
            }
        }
        const add = (attribute, kind) => {
            const attr = attrs.get(attribute);
            if (attr?.value && !/^(?:data|blob):/i.test(attr.value) && !attr.value.startsWith("#"))
                result.push({ href: attr.value, kind, start: attr.start, end: attr.end, attribute });
        };
        if (runtime) {
            if (scriptRange && !attrs.has("src"))
                runtime.scripts.push({ ...scriptRange, type: attrs.get("type")?.value.toLowerCase() ?? "" });
            for (const attribute of ["src", "href"])
                if (attrs.has(attribute))
                    add(attribute, name === "script" ? "script" : "image");
            // Runtime serves original MIME types; unlike data embedding, all URL attributes are useful.
            if (name === "script")
                continue;
            if (attrs.has("src") || attrs.has("href")) {
                if (name === "video")
                    add("poster", "image");
                if (name === "image")
                    add("xlink:href", "image");
                continue;
            }
        }
        if (name === "script")
            add("src", "script");
        if (name === "link" && attrs.get("rel")?.value.toLowerCase().split(/\s+/).includes("stylesheet"))
            add("href", "style");
        if (name === "img" || name === "input" && attrs.get("type")?.value.toLowerCase() === "image")
            add("src", "image");
        if (name === "video")
            add("poster", "image");
        if (name === "image") {
            add("href", "image");
            add("xlink:href", "image");
        }
    }
    return result.sort((a, b) => a.start - b.start);
}
export function htmlResourceLinks(html) {
    const links = new Map();
    for (const { href, kind } of htmlResourceTags(html))
        links.set(`${kind}:${href}`, { href, kind });
    return [...links.values()];
}
//# sourceMappingURL=html-preview.js.map