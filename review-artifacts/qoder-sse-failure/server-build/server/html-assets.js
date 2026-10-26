import { staticSvg } from "./svg-preview.js";
/** Bytes are embedded only as images/fonts, never as documents or executable URLs. */
export function htmlAssetMime(bytes, kind, extension) {
    const head = bytes.subarray(0, 4).toString("latin1");
    if (kind === "font") {
        if (bytes.length < 12)
            return;
        if (extension === ".woff" && head === "wOFF")
            return "font/woff";
        if (extension === ".woff2" && head === "wOF2")
            return "font/woff2";
        if (extension === ".otf" && head === "OTTO")
            return "font/otf";
        if (extension === ".ttf" && bytes.subarray(0, 4).equals(Buffer.from([0, 1, 0, 0])))
            return "font/ttf";
        return;
    }
    if (extension === ".svg")
        return staticSvg(bytes) ? "image/svg+xml" : undefined;
    if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])))
        return "image/png";
    if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255)
        return "image/jpeg";
    if (/^GIF8[79]a$/.test(bytes.subarray(0, 6).toString()))
        return "image/gif";
    if (head === "RIFF" && bytes.subarray(8, 12).toString() === "WEBP")
        return "image/webp";
    if (bytes.length >= 26 && head.startsWith("BM"))
        return "image/bmp";
    if (bytes.length >= 22 && bytes.subarray(0, 4).equals(Buffer.from([0, 0, 1, 0])))
        return "image/x-icon";
    if (bytes.length >= 16 && bytes.subarray(4, 8).toString() === "ftyp" && /^(avif|avis)$/.test(bytes.subarray(8, 12).toString()))
        return "image/avif";
}
//# sourceMappingURL=html-assets.js.map