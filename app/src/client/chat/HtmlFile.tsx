import { useMemo } from "react";
import { htmlResourceTags, type HtmlResource } from "../../shared/html-preview.js";

// Never grant allow-same-origin: documents cannot reach the workbench or the
// trusted wrapper. The wrapper's frame-src also blocks document self-navigation.
const policy = "default-src 'none'; script-src 'unsafe-inline' data:; style-src 'unsafe-inline' data:; img-src data: blob:; font-src data:; media-src data: blob:; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";
const escapeAttribute = (value: string) => value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
export function HtmlFile({ text, name, resources }: { text: string; name: string; resources?: HtmlResource[] }) {
  const source = useMemo(() => {
    let embedded = text;
    for (const tag of htmlResourceTags(text).reverse()) {
      const resource = resources?.find(item => item.href === tag.href && item.kind === tag.kind);
      if (!resource) continue;
      const bytes = new TextEncoder().encode(resource.text);
      let binary = "";
      for (const byte of bytes) binary += String.fromCharCode(byte);
      const value = `data:${tag.kind === "script" ? "text/javascript" : "text/css"};base64,${btoa(binary)}`;
      embedded = embedded.slice(0, tag.start) + `${tag.kind === "script" ? "src" : "href"}="${value}"` + embedded.slice(tag.end);
    }
    const header = `<meta http-equiv="Content-Security-Policy" content="${policy}"><meta name="referrer" content="no-referrer">`;
    const document = `<!doctype html>${header}${embedded}`;
    // srcdoc is permitted by frame-src 'none'; any URL navigation by the child
    // is checked against this trusted parent policy before making a request.
    return `<!doctype html>${header}<style>html,body{margin:0;width:100%;height:100%;overflow:hidden}iframe{display:block;width:100%;height:100%;border:0}</style><iframe title="HTML 文档" sandbox="allow-scripts" referrerpolicy="no-referrer" srcdoc="${escapeAttribute(document)}"></iframe>`;
  }, [text, resources]);
  return <iframe className="file-html-frame" title={`HTML 预览：${name}`} sandbox="allow-scripts" referrerPolicy="no-referrer" srcDoc={source} />;
}
