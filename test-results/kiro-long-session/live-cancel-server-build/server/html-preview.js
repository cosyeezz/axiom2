import { constants } from "node:fs";
import { setImmediate as yieldWork } from "node:timers/promises";
import { lstat, open, realpath } from "node:fs/promises";
import { dirname, extname, isAbsolute, relative, resolve } from "node:path";
import { cssResourceTags, htmlResourceLinks } from "../shared/html-preview.js";
import { htmlAssetMime } from "./html-assets.js";
const key = (value) => process.platform === "win32" ? value.toLowerCase() : value;
const MiB = 1024 * 1024;
/** Bounded static dependencies, including recursive CSS imports; JS runs only by opt-in. */
export async function htmlResources(path, text, authorize, signal) {
    const resources = [], directory = dirname(path);
    let total = 0, textTotal = 0, textCount = 0, assetCount = 0, embeddedTotal = 0, skipped = 0, edges = 0;
    const encoded = new WeakMap();
    const cache = new Map();
    const load = async (href, kind, base) => {
        signal.throwIfAborted();
        if (++edges > 512) {
            skipped++;
            return null;
        }
        if (edges % 32 === 0)
            await yieldWork(undefined, { signal });
        const cacheKey = `${base}:${kind}:${href}`;
        if (cache.has(cacheKey)) {
            const value = cache.get(cacheKey);
            if (!value)
                skipped++;
            return value;
        }
        cache.set(cacheKey, null);
        const textual = kind === "style" || kind === "script";
        if (textual ? ++textCount > 16 : ++assetCount > 48) {
            skipped++;
            return null;
        }
        try {
            signal.throwIfAborted();
            authorize();
            const name = decodeURIComponent(href.split(/[?#]/, 1)[0]).replace(/\\/g, "/");
            if (!name || /[\x00-\x1f\x7f:]/.test(name) || isAbsolute(name) || name.startsWith("/") || name.split("/").some(part => part.startsWith(".") && part !== "." && part !== ".."))
                throw new Error("path");
            const extension = extname(name).toLowerCase();
            const allowed = kind === "style" ? [".css"] : kind === "script" ? [".js", ".mjs"] : kind === "font" ? [".woff", ".woff2", ".ttf", ".otf"] : [".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".ico", ".avif", ".svg"];
            if (!allowed.includes(extension))
                throw new Error("type");
            const target = resolve(base, name), rel = relative(directory, target);
            if (!rel || rel.startsWith("..") || isAbsolute(rel) || key(await realpath(target)) !== key(target))
                throw new Error("path");
            const before = await lstat(target), limit = textual ? MiB : 2 * MiB;
            if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1 || before.size > limit || total + before.size > 8 * MiB || textual && textTotal + before.size > 2 * MiB)
                throw new Error("size");
            const handle = await open(target, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
            let bytes;
            try {
                const info = await handle.stat();
                if (!info.isFile() || info.nlink !== 1 || info.dev !== before.dev || info.ino !== before.ino || info.size !== before.size)
                    throw new Error("changed");
                const buffer = Buffer.alloc(info.size + 1);
                let length = 0;
                while (length < buffer.length) {
                    const result = await handle.read(buffer, length, buffer.length - length, length);
                    if (!result.bytesRead)
                        break;
                    length += result.bytesRead;
                }
                const after = await lstat(target), final = await handle.stat();
                if (key(await realpath(target)) !== key(target) || after.isSymbolicLink() || after.nlink !== 1 || after.dev !== info.dev || after.ino !== info.ino || final.size !== info.size || final.mtimeMs !== info.mtimeMs || final.ctimeMs !== info.ctimeMs || length !== info.size)
                    throw new Error("changed");
                signal.throwIfAborted();
                authorize();
                bytes = buffer.subarray(0, length);
            }
            finally {
                await handle.close();
            }
            let resource;
            if (textual) {
                let content = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
                if (content.includes("\0"))
                    throw new Error("binary");
                total += bytes.length;
                textTotal += bytes.length;
                if (kind === "style") {
                    const tags = cssResourceTags(content).reverse();
                    for (const [index, tag] of tags.entries()) {
                        if (edges >= 512 || embeddedTotal >= 12 * MiB) {
                            skipped += tags.length - index;
                            break;
                        }
                        const asset = await load(tag.href, tag.kind, dirname(target));
                        if (!asset)
                            continue;
                        let url = asset.dataUrl ?? encoded.get(asset);
                        const estimated = url?.length ?? (asset.text !== undefined ? 21 + 4 * Math.ceil(Buffer.byteLength(asset.text) / 3) : 0);
                        if (!estimated)
                            continue;
                        if (embeddedTotal + estimated + 5 > 12 * MiB || content.length - (tag.end - tag.start) + estimated + 5 > 12 * MiB) {
                            skipped++;
                            continue;
                        }
                        if (!url && asset.text !== undefined) {
                            url = `data:text/css;base64,${Buffer.from(asset.text).toString("base64")}`;
                            encoded.set(asset, url);
                        }
                        const replacement = `url(${url})`;
                        embeddedTotal += replacement.length;
                        content = content.slice(0, tag.start) + replacement + content.slice(tag.end);
                    }
                }
                resource = { href, kind, text: content };
            }
            else {
                const mime = htmlAssetMime(bytes, kind, extension);
                if (!mime)
                    throw new Error("signature");
                total += bytes.length;
                resource = { href, kind, dataUrl: `data:${mime};base64,${bytes.toString("base64")}` };
            }
            cache.set(cacheKey, resource);
            return resource;
        }
        catch {
            signal.throwIfAborted();
            authorize();
            skipped++;
            return null;
        }
    };
    for (const link of htmlResourceLinks(text)) {
        if (edges >= 512) {
            skipped++;
            break;
        }
        const resource = await load(link.href, link.kind, directory);
        if (resource)
            resources.push(resource);
    }
    return { resources, ...(skipped ? { resourceNotice: `${skipped} 个页面资源未加载（缺失、格式不支持、超限或路径不允许）` } : {}) };
}
//# sourceMappingURL=html-preview.js.map