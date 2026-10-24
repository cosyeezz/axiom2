import { useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { Select } from "../../src/client/Select.js";
import { ComboInput } from "../../src/client/ComboInput.js";
import { MemoryFilter } from "../../src/client/memory/MemoryFilter.js";
import { ConnectionAddressSelect } from "../../src/client/settings/ConnectionAddressSelect.js";
import DeviceSelect from "../../src/client/pages/DeviceSelect.js";
import { TooltipLayer } from "../../src/client/TooltipLayer.js";
import { AnnotatedReply, AnnotationToggle } from "../../src/client/chat/ReplyAnnotations.js";
import "../../src/client/platform.js";
import "../../src/client/styles/tokens.css";
import "../../src/client/styles/workbench.css";
import "../../src/client/styles/models.css";
import "../../src/client/styles/chat.css";
import "../../src/client/styles/memory.css";
import "../../src/client/styles/phone-connect.css";
import "../../src/client/styles/connect.css";
import "../../src/client/styles/processing.css";
import "../../src/client/styles/mobile.css";

const options = Array.from({ length: 50 }, (_, index) => ({ value: String(index), label: `Option ${String(index).padStart(2, "0")}` }));
const addresses = options.map((_, index) => `http://100.64.0.${index + 1}:6000`);
const scope = { workspaceId: "ui-fixture", sessionId: "ui-fixture" };
function Fixture() {
  const [selected, setSelected] = useState("38"), [text, setText] = useState("");
  const [address, setAddress] = useState(addresses[38]), [device, setDevice] = useState("local");
  const dialog = useRef<HTMLDialogElement>(null);
  return <>
    <style>{`body{padding:16px}main{max-width:600px;margin:auto}section{margin-bottom:20px;min-width:0}#scroller{height:180px;overflow:auto;border:1px solid var(--border);padding:12px}#scroller>div{padding-block:40px 300px}.control{max-width:280px;margin-bottom:12px}#tip-anchor{position:fixed;right:24px;bottom:100px}#annotation-fixture{margin-block:20px}.memory-summary-toggle{max-width:100%}#modal{width:min(520px,calc(100vw - 32px));max-height:80vh;background:var(--bg);color:var(--fg)}#copy-result{display:block}`}</style>
    <main>
      <section id="scroller"><div>
        <div className="control"><Select label="共享选择" value={selected} options={options} onChange={setSelected} /></div>
        <div className="control"><MemoryFilter label="记忆筛选" value={selected} options={options} onChange={setSelected} /></div>
        <div className="control"><ConnectionAddressSelect value={address} options={addresses} onChange={setAddress} /></div>
        <div className="control"><ComboInput label="建议输入" value={text} options={options.map(option => option.label)} onChange={setText} /></div>
      </div></section>
      <section className="connect-page" style={{ minHeight: 0, padding: 0 }}><DeviceSelect value={device} disabled={false} onChange={setDevice} /><output id="device-value">{device}</output></section>
      <section id="long-memory"><button className="memory-summary-toggle"><span className="memory-source-copy"><strong>{"LongUnbrokenSessionTitle".repeat(35)}</strong><small>记忆来源</small></span></button></section>
      <section className="processing-filters"><label>状态<select><option>全部</option></select></label><label>搜索<input aria-label="搜索记录" /></label></section>
      <section className="auto-compression-field"><label>子任务预算<input className="input" type="number" defaultValue="3" /></label></section>
      <button id="open-modal" onClick={() => dialog.current?.showModal()}>打开模态框</button>
      <dialog ref={dialog} id="modal"><h2>模态框</h2><Select label="模态选择" value={selected} options={options} onChange={setSelected} />
        <button id="copy-modal" onClick={() => navigator.clipboard.writeText("inside-modal").then(() => { document.querySelector("#copy-result")!.textContent = "copied"; })}>复制</button><output id="copy-result" /><button onClick={() => dialog.current?.close()}>关闭</button></dialog>
      <section id="annotation-fixture"><AnnotationToggle scope={scope} /><AnnotatedReply scope={scope} messageId="reply" text="This paragraph is ready for annotation." /></section>
      <button id="tip-anchor" data-tooltip={"可视区域提示 ".repeat(80)}>提示</button>
    </main><TooltipLayer />
  </>;
}
createRoot(document.getElementById("root")!).render(<Fixture />);
