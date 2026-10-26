import { Marked, Tokenizer } from "marked";
const definitionStart = /^ {0,3}\[\^([^\]\s]+)\]:[ \t]*([^\n]*)(?:\n|$)/;
/** Shared block grammar also keeps footnote metadata out of the progress projection. */
export function footnoteDefinition(source) {
    const first = definitionStart.exec(source);
    if (!first)
        return;
    let raw = first[0], text = first[2];
    for (;;) {
        const continuation = /^(?:[ \t]*\n)*(?: {4}|\t)[^\n]*(?:\n|$)/.exec(source.slice(raw.length));
        if (!continuation)
            break;
        raw += continuation[0];
        text += "\n" + continuation[0].replace(/^(?: {4}|\t)/gm, "").replace(/\n$/, "");
    }
    return { raw, id: first[1], text };
}
/** Shared parser keeps displayed image references and server authorization identical. */
export const markdown = new Marked({
    // Chat input uses single newlines as visible line breaks within paragraphs.
    breaks: true,
    extensions: [
        {
            name: "footnote_definition", level: "block",
            start(source) { return source.match(/^ {0,3}\[\^[^\]\s]+\]:/m)?.index; },
            tokenizer(source) {
                const definition = footnoteDefinition(source);
                if (definition)
                    return { type: "footnote_definition", ...definition, tokens: this.lexer.blockTokens(definition.text) };
            },
        },
        {
            name: "footnote_reference", level: "inline",
            start(source) { return source.indexOf("[^"); },
            tokenizer(source) {
                const match = /^\[\^([^\]\s]+)\](?!:)/.exec(source);
                if (match)
                    return { type: "footnote_reference", raw: match[0], id: match[1] };
            },
        },
    ],
    tokenizer: {
        emStrong(source, maskedSource) {
            // Marked checks the opening delimiter against the original source, not
            // the mask. Allow Chinese opening punctuation after adjacent prose while
            // letting its tokenizer preserve nesting, escapes and original token text.
            if (/^\*{2}[“‘（【《「『〔〈〖〘〚]/.test(source)) {
                return Tokenizer.prototype.emStrong.call(this, source, maskedSource, "") ?? false;
            }
            return false;
        },
    },
    hooks: {
        emStrongMask(source) {
            // Relax CJK closing punctuation only in the delimiter-analysis mask.
            return source.replace(/[、。，！？；：）》」』】〕〉〗〙〛”’](?=\*{2}(?!\*))/g, "a");
        },
    },
});
/** First definition wins for rendering and every file-reference authorization path. */
export function markdownTokens(text) {
    const ast = markdown.lexer(text), definitions = new Set();
    markdown.walkTokens(ast, (token) => {
        if (token.type !== "footnote_definition")
            return;
        if (definitions.has(token.id))
            token.tokens = [];
        else
            definitions.add(token.id);
    });
    return ast;
}
export function markdownLocalLinks(text) {
    const links = [];
    markdown.walkTokens(markdownTokens(text), (token) => {
        if ((token.type === "link" || token.type === "image") && token.href &&
            !/^(?:[a-z][a-z\d+.-]*:|#)/i.test(token.href.replace(/^[A-Za-z]:[\\/]/, "/")))
            links.push({ href: token.href, label: token.text });
    });
    return links;
}
/** Absolute local paths only. Never turn network/device URLs into file reads. */
export function markdownImagePath(href) {
    if (!href || href.length > 4096 || /[\x00-\x1f\x7f]/.test(href))
        return null;
    const path = href.replace(/\\/g, "/");
    if (!/^(?:[a-zA-Z]:\/|\/(?!\/))/.test(path) || path.startsWith("//") ||
        path.split("/").includes("..") || /[:]/.test(path.replace(/^[a-zA-Z]:/, "")))
        return null;
    return path;
}
export function hasMarkdownImage(text, href) {
    let found = false;
    markdown.walkTokens(markdownTokens(text), (token) => {
        if (token.type === "image" && token.href === href)
            found = true;
    });
    return found;
}
//# sourceMappingURL=markdown.js.map