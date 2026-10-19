import { Icon } from "../Icon.js";
const names = { source: "code-xml", split: "columns-2", reading: "book-open", folder: "folder-open", close: "close", text: "file-text", image: "image", file: "file-text", reload: "rotate-cw", wrap: "wrap-text", minus: "zoom-out", plus: "zoom-in", fit: "scan" };
export type FileIconName = keyof typeof names;
export function FileIcon({ name }: { name: FileIconName }) { return <Icon name={names[name]} />; }
