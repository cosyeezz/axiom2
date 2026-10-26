import ts from "typescript";
import { cssResourceTags, htmlResourceTags } from "../shared/html-preview.js";
export const htmlAttribute = (value) => value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
const rooted = (url, prefix) => url.startsWith("/") && !url.startsWith("//") && !url.startsWith(prefix) ? prefix + url.slice(1) : url;
function javascript(text, prefix) {
    // React development bundles with inline sourcemaps exceed 2 MiB. Keep parsing
    // bounded while allowing these common modules (HTTP responses remain capped separately).
    if (Buffer.byteLength(text, "utf8") > 8 * 1024 * 1024)
        throw Error("脚本超过 8 MiB 解析上限");
    const source = ts.createSourceFile("preview.js", text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
    const changes = [];
    const visit = (node) => {
        // Only module specifiers are syntax-rewritten. Business strings/tagged templates remain intact.
        if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
            const value = node.moduleSpecifier;
            if (rooted(value.text, prefix) !== value.text)
                changes.push({ start: value.getStart(source), end: value.end, value: JSON.stringify(rooted(value.text, prefix)) });
        }
        if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword && node.arguments[0]) {
            const arg = node.arguments[0];
            // Insert around the expression, rather than replacing its nested imports.
            changes.push({ start: arg.getStart(source), end: arg.getStart(source), value: `((u)=>typeof u==="string"&&u.startsWith("/")&&!u.startsWith("//")&&!u.startsWith(${JSON.stringify(prefix)})?${JSON.stringify(prefix)}+u.slice(1):u)(` });
            changes.push({ start: arg.end, end: arg.end, value: ")" });
        }
        ts.forEachChild(node, visit);
    };
    visit(source);
    for (const change of changes.sort((a, b) => b.start - a.start || b.end - a.end))
        text = text.slice(0, change.start) + change.value + text.slice(change.end);
    return text;
}
function bootstrap(prefix) {
    // Runtime mapping preserves computed URLs without rewriting unrelated program strings.
    return `(()=>{const prefix=${JSON.stringify(prefix)},map=u=>{try{const v=new URL(String(u),document.baseURI);if(v.origin===location.origin&&!v.pathname.startsWith(prefix))v.pathname=prefix+v.pathname.slice(1);return v.href}catch{return u}};
const fetch=window.fetch;window.fetch=function(input,init){return fetch.call(this,input instanceof Request?new Request(map(input.url),input):map(input),init)};
const open=XMLHttpRequest.prototype.open;XMLHttpRequest.prototype.open=function(method,url,...args){return open.call(this,method,map(url),...args)};
const set=Element.prototype.setAttribute;Element.prototype.setAttribute=function(name,value){return set.call(this,name,/^(src|href|poster)$/i.test(name)?map(value):value)};
for(const [type,key] of [[HTMLImageElement,'src'],[HTMLScriptElement,'src'],[HTMLLinkElement,'href'],[HTMLMediaElement,'src'],[HTMLSourceElement,'src'],[HTMLVideoElement,'poster']]){const d=Object.getOwnPropertyDescriptor(type.prototype,key);if(d&&d.set)Object.defineProperty(type.prototype,key,{...d,set(v){d.set.call(this,map(v))}})}
})();`;
}
/** Root URL adaptation for a capability-prefixed, opaque-origin document. Not a general bundler. */
export function rewritePreview(text, mime, prefix, base) {
    if (mime.includes("javascript"))
        return javascript(text, prefix);
    const local = (url) => rooted(url, prefix);
    const changes = [];
    const css = (url) => `url(${JSON.stringify(local(url))})`;
    if (mime === "text/css") {
        for (const tag of cssResourceTags(text))
            if (local(tag.href) !== tag.href)
                changes.push({ ...tag, value: css(tag.href) });
    }
    else if (mime === "text/html") {
        const runtime = { scripts: [] };
        for (const tag of htmlResourceTags(text, runtime))
            if (local(tag.href) !== tag.href)
                changes.push({ ...tag, value: tag.attribute ? `${tag.attribute}="${htmlAttribute(local(tag.href))}"` : tag.urlOnly ? htmlAttribute(local(tag.href)) : tag.inAttribute ? htmlAttribute(css(tag.href)) : css(tag.href) });
        for (const script of runtime.scripts) {
            const value = text.slice(script.start, script.end);
            if (["", "module", "text/javascript", "application/javascript"].includes(script.type))
                changes.push({ ...script, value: javascript(value, prefix).replace(/<\/script/gi, "<\\/script") });
            else if (script.type === "importmap") {
                const data = JSON.parse(value), remap = (map) => Object.fromEntries(Object.entries(map).map(([key, value]) => [local(key), typeof value === "string" ? local(value) : value]));
                if (data.imports)
                    data.imports = remap(data.imports);
                if (data.scopes)
                    data.scopes = Object.fromEntries(Object.entries(data.scopes).map(([key, value]) => [local(key), remap(value)]));
                changes.push({ ...script, value: JSON.stringify(data).replace(/</g, "\\u003c") });
            }
        }
    }
    for (const change of changes.sort((a, b) => b.start - a.start))
        text = text.slice(0, change.start) + change.value + text.slice(change.end);
    if (mime === "text/html")
        text = `<!doctype html><base href="${htmlAttribute(base)}"><meta name="referrer" content="no-referrer"><script>${bootstrap(prefix)}</script>${text}`;
    return text;
}
export function previewPolicy(origin, prefix, network) {
    const local = origin + prefix, remote = network ? " http: https:" : "";
    return `default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' ${local} data: blob:${remote}; style-src 'unsafe-inline' ${local} data:${remote}; img-src ${local} data: blob:${remote}; font-src ${local} data:${remote}; media-src ${local} data: blob:${remote}; connect-src ${local}${remote}${network ? " ws: wss:" : ""}; frame-src 'none'; object-src 'none'; base-uri ${local}; form-action 'none'; sandbox allow-scripts`;
}
//# sourceMappingURL=preview-rewrite.js.map