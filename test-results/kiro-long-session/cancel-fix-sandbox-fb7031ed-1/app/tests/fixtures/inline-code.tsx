import { useState } from "react";
import { createRoot } from "react-dom/client";
import "../../src/client/platform.js";
import { Markdown } from "../../src/client/chat/Markdown.js";
import { rangeOffsets, textRange } from "../../src/client/chat/annotation-ranges.js";
import { TooltipLayer } from "../../src/client/TooltipLayer.js";
import { initializeTheme, setTheme } from "../../src/client/theme.js";
import icons from "../../src/client/icons.svg?raw";
import "../../src/client/styles/tokens.css";
import "../../src/client/styles/workbench.css";
import "../../src/client/styles/chat.css";
import "../../src/client/styles/thinking.css";
import "../../src/client/styles/action-icons.css";
import "../../src/client/styles/icon-geometry.css";
import "../../src/client/styles/mobile.css";
import "../../src/client/styles/theme.css";

initializeTheme();
const sprite = document.createElement("div"); sprite.innerHTML = icons; sprite.hidden = true; document.body.append(sprite);
const table = "| 邮箱 | 验证结果 |\n| --- | --- |\n| `hffp@qhhfdb.com` | 成功查询 3 封已读邮件，并读取其中 1 封正文；另外两封开票申请邮件各有 1 个附件 |\n| `zzxfp@89holdings.com` | 分组权限已通过，但 MCP 连接邮箱时返回 `LOGIN failed`，尚未读取成功 |";
const prose = '正文中的 `hello  world`、`LOGIN failed` 和 `中文 & <tag> "引号"` 都可以单独复制。后续文字保持准确。';
function Fixture() {
  const [source, setSource] = useState("streaming-old"), [shown, setShown] = useState(true);
  const [events, setEvents] = useState(0);
  Object.assign(window, { inlineFixture: { setSource, setShown, setTheme, rangeOffsets, textRange } });
  return <>
    <main className="reply-body" style={{ maxWidth: 760, margin: "auto", padding: 16 }} onClick={() => setEvents(value => value + 1)}>
      <div className="markdown">
        <section id="table"><Markdown text={table} /></section>
        <section id="prose"><Markdown text={prose} /></section>
        <section id="long"><Markdown text={`很长的内容也应完整显示：\`${"long_token_".repeat(30)}\`，后文。`} /></section>
        <section id="wrapping" style={{ maxWidth: 170 }}><Markdown text="窄列里的 `a_very_long_email_address@example.test` 以及 `short`，后文。" /></section>
        <section id="adjacent"><Markdown text="`one``two` `three`、`four`。" /></section>
        <section id="unicode"><Markdown text="组合字符 `café`，emoji `👨‍👩‍👧‍👦` 与 `🇨🇳`。" /></section>
        <section id="stream">{shown && <Markdown text={`\`${source}\``} />}</section>
        <section id="nested"><Markdown text="[`link code`](https://example.com) 和 [`local link`](/tmp/example.ts)，路径 `/tmp/example.ts`。" /></section>
        <section id="block"><Markdown text={'```text\nfirst line\nsecond line\n```'} /></section>
        <section id="thinking"><details className="thinking-block" data-inline open><summary className="thinking-header"><span className="thinking-text">思考</span></summary><div className="thinking-body markdown"><Markdown text="思考中的 `inline` 和后续文字。" /></div></details></section>
        <details id="compact"><summary><Markdown compact text="摘要 `plain`，**重点** 和 [链接 `code`](https://example.com)。" /></summary></details>
        <output id="events">{events}</output>
      </div>
    </main>
    <TooltipLayer />
  </>;
}
createRoot(document.getElementById("root")!).render(<Fixture />);
