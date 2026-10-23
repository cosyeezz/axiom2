import catalog from "./font-catalog.json" with { type: "json" };
import type { CustomFontId, OnlineFont } from "./font-library.js";

export const fontCatalogCommit = catalog.googleFontsCommit;
const base = `https://raw.githubusercontent.com/google/fonts/${fontCatalogCommit}/`;
const repository = `https://github.com/google/fonts/blob/${fontCatalogCommit}/`;
const categories: Record<string, string> = { "sans-serif": "无衬线", serif: "衬线", monospace: "等宽", handwriting: "手写", display: "展示" };
const chineseNames: Record<string, string> = {
  "noto-sans-sc": "思源黑体", "noto-serif-sc": "思源宋体",
  "lxgw-wenkai-tc": "霞鹜文楷", "lxgw-wenkai-mono-tc": "霞鹜文楷等宽", "lxgw-marker-gothic": "霞鹜漫黑",
  "zcool-kuaile": "站酷快乐体", "zcool-qingke-huangyou": "站酷庆科黄油体", "zcool-xiaowei": "站酷小薇体",
  "ma-shan-zheng": "马善政楷书", "liu-jian-mao-cao": "刘建毛草", "long-cang": "龙藏体", "zhi-mang-xing": "志莽行书",
  "huninn": "粉圆", "iansui": "芫荽", "noto-sans-tc": "思源黑体繁体", "noto-serif-tc": "思源宋体繁体",
  "noto-sans-hk": "思源黑体香港", "noto-serif-hk": "思源宋体香港",
};
const encodePath = (path: string) => path.split("/").map(encodeURIComponent).join("/");
const size = (bytes: number) => bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.ceil(bytes / 1024)} KB`;
// Keep established IDs so existing saved fonts and display preferences survive catalog updates.
export const onlineFonts: OnlineFont[] = catalog.fonts.map(font => {
  const chinese = font.subsets.filter(subset => subset.startsWith("chinese"));
  const language = chinese.length ? chinese.map(subset => subset === "chinese-simplified" ? "简体中文" : subset === "chinese-hongkong" ? "香港中文" : "繁体中文").join(" / ") : font.subsets.includes("latin") ? "拉丁字母" : font.subsets.length ? "其他语言" : "语言未标注";
  return {
    id: font.id as CustomFontId, name: chineseNames[font.slug] ? `${chineseNames[font.slug]} · ${font.family}` : font.name,
    family: font.family, aliases: [...font.aliases, chineseNames[font.slug] ?? ""].join(" "),
    category: font.category, languages: font.subsets, bytes: font.size, weight: font.weight, style: font.style, variable: font.variable,
    description: `${language} · ${categories[font.category]}${font.style === "italic" ? " · 斜体" : ""} · ${size(font.size)}`,
    url: base + encodePath(font.path), source: repository + encodePath(font.path.slice(0, font.path.lastIndexOf("/"))),
    license: font.license === "OFL-1.1" ? "SIL OFL 1.1" : "Apache 2.0", licenseUrl: repository + encodePath(font.licensePath),
  };
}).sort((a, b) => {
  const priority = (font: OnlineFont) => font.id === "custom:noto-sans-sc" ? 0 : font.id === "custom:noto-serif-sc" ? 1 : font.id === "custom:inter" ? 2 : font.id === "custom:lora" ? 3 : font.languages?.some(value => value.startsWith("chinese")) ? 4 : 5;
  return priority(a) - priority(b) || a.name.localeCompare(b.name, "en");
});
