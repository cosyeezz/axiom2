import { useMemo, useState } from "react";
import { htmlResourceTags, type HtmlResource } from "../../shared/html-preview.js";

// Never grant allow-same-origin: documents cannot reach the workbench or the
// trusted wrapper. The wrapper's frame-src also blocks document self-navigation.
// CSP does not block every script network API (notably WebRTC); disabling
// ordinary networking must never be described as fully offline.
const offlinePolicy = "default-src 'none'; script-src 'unsafe-inline' data:; style-src 'unsafe-inline' data:; img-src data: blob:; font-src data:; media-src data: blob:; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";
const escapeAttribute = (value: string) => value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
export function HtmlFile({ text, name, resources }: { text: string; name: string; resources?: HtmlResource[] }) {
  const [scripts, setScripts] = useState(true), [network, setNetwork] = useState(true);
  const sandbox = scripts ? "allow-scripts" : "";
  const source = useMemo(() => {
    let embedded = text, omitted = 0;
    const values = new Map<string, string>();
    for (const resource of resources ?? []) {
      let value = resource.dataUrl;
      if (!value && resource.text !== undefined) {
        const bytes = new TextEncoder().encode(resource.text);
        let binary = "";
        for (const byte of bytes) binary += String.fromCharCode(byte);
        value = `data:${resource.kind === "script" ? "text/javascript" : "text/css"};base64,${btoa(binary)}`;
      }
      if (value) values.set(`${resource.kind}:${resource.href}`, value);
    }
    for (const tag of htmlResourceTags(text).reverse()) {
      const value = values.get(`${tag.kind}:${tag.href}`);
      if (!value) continue;
      const replacement = tag.attribute ? `${tag.attribute}="${escapeAttribute(value)}"` : tag.urlOnly ? escapeAttribute(value) : `url(${value})`;
      if (embedded.length + replacement.length > 16 * 1024 * 1024) { omitted++; continue; }
      embedded = embedded.slice(0, tag.start) + replacement + embedded.slice(tag.end);
    }
    const policy = network ? offlinePolicy.replace("script-src 'unsafe-inline' data:", "script-src 'unsafe-inline' data: http: https:").replace("style-src 'unsafe-inline' data:", "style-src 'unsafe-inline' data: http: https:").replace("img-src data: blob:", "img-src data: blob: http: https:").replace("font-src data:", "font-src data: http: https:").replace("media-src data: blob:", "media-src data: blob: http: https:").replace("connect-src 'none'", "connect-src http: https: ws: wss:") : offlinePolicy;
    const header = `<meta http-equiv="Content-Security-Policy" content="${policy}"><meta name="referrer" content="no-referrer">`;
    const document = `<!doctype html>${header}${embedded}`;
    // srcdoc is permitted by frame-src 'none'; any URL navigation by the child
    // is checked against this trusted parent policy before making a request.
    return { omitted, document: `<!doctype html>${header}<style>html,body{margin:0;width:100%;height:100%;overflow:hidden}iframe{display:block;width:100%;height:100%;border:0}</style><iframe title="HTML 文档" sandbox="${sandbox}" referrerpolicy="no-referrer" srcdoc="${escapeAttribute(document)}"></iframe>` };
  }, [text, resources, sandbox, network]);
  return <><div className="file-html-safety"><span>{scripts ? "页面脚本已启用" : "页面脚本已停用"} · {network ? "已允许联网" : "已禁止普通联网"}</span><button type="button" className="file-edit-action" aria-pressed={scripts} onClick={() => setScripts(value => !value)}>{scripts ? "停用页面脚本" : "启用页面脚本"}</button><button type="button" className="file-edit-action" aria-pressed={network} onClick={() => setNetwork(value => !value)}>{network ? "禁止普通联网" : "允许联网"}</button></div>{source.omitted > 0 && <p className="file-editor-notice" role="status">部分重复资源超过页面展开上限，未全部展示。</p>}<iframe className="file-html-frame" title={`HTML 预览：${name}`} sandbox={sandbox} referrerPolicy="no-referrer" srcDoc={source.document} /></>;
}
