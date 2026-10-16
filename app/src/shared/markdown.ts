import { Marked, Tokenizer } from "marked";

/** Shared parser keeps displayed image references and server authorization identical. */
export const markdown = new Marked({
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

/** Absolute local paths only. Never turn network/device URLs into file reads. */
export function markdownImagePath(href: string): string | null {
  if (!href || href.length > 4096 || /[\x00-\x1f\x7f]/.test(href)) return null;
  const path = href.replace(/\\/g, "/");
  if (!/^(?:[a-zA-Z]:\/|\/(?!\/))/.test(path) || path.startsWith("//") ||
    path.split("/").includes("..") || /[:]/.test(path.replace(/^[a-zA-Z]:/, ""))) return null;
  return path;
}

export function hasMarkdownImage(text: string, href: string): boolean {
  let found = false;
  markdown.walkTokens(markdown.lexer(text), (token) => {
    if (token.type === "image" && token.href === href) found = true;
  });
  return found;
}
