import { useState } from "react";
import { createRoot } from "react-dom/client";
import { Select } from "../../src/client/Select.js";
import { ComboInput } from "../../src/client/ComboInput.js";
import { OfficeFile } from "../../src/client/chat/OfficeFile.js";
import { WebPreview } from "../../src/client/chat/WebPreview.js";
import { Capabilities } from "../../src/client/chat/Capabilities.js";
import { AutoCompressionSettings } from "../../src/client/chat/AutoCompressionSettings.js";
import { ProviderConnection } from "../../src/client/models/ProviderConnection.js";
import type { ProviderDraft } from "../../src/shared/models.js";
import { BudgetEditor } from "../../src/client/maintenance/MaintenanceView.js";
import { defaultMaintenanceBudgets } from "../../src/shared/maintenance.js";
import { connect } from "../../src/client/transport.js";
import type { OpenFileReference } from "../../src/client/chat/FileLink.js";
import "../../src/client/styles/tokens.css";
import "../../src/client/styles/models.css";
import "../../src/client/styles/model-interactions.css";
import "../../src/client/styles/workbench.css";
import "../../src/client/styles/file-preview.css";
import "../../src/client/styles/processing.css";
import "../../src/client/styles/resources.css";
import "../../src/client/styles/environment-inventory.css";
import "../../src/client/styles/page-overrides.css";

const scope = { workspaceId: "fixture", sessionId: "fixture" };
const reference = { href: "project/index.html", messageId: "fixture", owner: { scope } } as OpenFileReference;
const longName = "长名称-workspace-project-".repeat(12);
const parts = [{ name: "xl/workbook.xml", text: `<workbook xmlns:r="urn:relationships"><sheets><sheet name="${longName}" r:id="r1"/><sheet name="第二张表" r:id="r2"/></sheets></workbook>` }];
function ProviderFixture() {
  const [provider, setProvider] = useState<ProviderDraft>({ id: "fixture-provider", providerId: "", name: "", api: "openai-completions", url: "", key: "", headers: [], body: [], models: [] });
  return <><ProviderConnection p={provider} storage={undefined} tab="suppliers" templates={[{ id: "fixture-api", name: "示例供应商", api: "openai-completions", url: "https://example.invalid/v1" }]}
    patch={patch => setProvider(value => ({ ...value, ...patch }))} showKey={false} setShowKey={() => {}} dirty={false} editor={null} busy={false} needsReconcile={false} setLogin={() => {}} feedback="" logoutProvider={() => {}} removeProvider={() => {}} />
    <button id="lock-provider" onClick={() => setProvider(value => ({ ...value, originalId: value.providerId }))}>模拟已有供应商</button></>;
}
function Fixture() {
  const [value, setValue] = useState(longName);
  return <main style={{ padding: 12 }}>
    <style>{`.sample { width: min(var(--sample-width, 300px), 100%); min-width: 0; margin-bottom: 24px; border: 1px solid var(--border); } .sample h2 { font-size: 14px; } .fixture-select-row { display: flex; flex-wrap: wrap; gap: 8px; }`}</style>
    <section className="sample" id="select-sample"><div className="fixture-select-row"><Select label="长选项" value={value} onChange={setValue} options={[{ value: longName, label: longName }, { value: "short", label: "短选项" }]} /><button className="btn">刷新</button></div>
      <ComboInput label="长建议" value={value} onChange={setValue} options={[longName, "short"]} /></section>
    <section className="sample" id="narrow-select-sample"><div style={{ width: 80 }}><Select label="请求体类型" value="text" onChange={() => {}} options={[{ value: "text", label: "文本" }, { value: "number", label: "数字" }]} /></div></section>
    <section className="sample" id="office-sample"><OfficeFile parts={parts} /></section>
    <section className="sample" id="web-sample" style={{ height: 600 }}><WebPreview reference={reference}><p>静态阅读内容</p></WebPreview></section>
    <section className="sample" id="budget-sample"><BudgetEditor value={defaultMaintenanceBudgets} onSave={async () => {}} /></section>
    <section className="sample" id="auto-sample"><AutoCompressionSettings contextWindow={200000} /></section>
    <section className="sample" id="processing-sample"><div className="processing-filters"><label>状态<select aria-label="筛选状态"><option>全部状态</option><option>处理中</option></select></label><label>搜索<input placeholder="请求名称" /></label><button className="btn">刷新</button></div></section>
    <section className="sample environment-confirm" id="checkbox-sample"><label><input type="checkbox" /><span>我已关闭使用此安装的终端会话，并确认上述范围。{longName}</span></label><label className="resources-overwrite"><input type="checkbox" /><span>覆盖同名资源</span></label></section>
    <section className="sample" id="provider-sample"><div className="supplier-detail"><ProviderFixture /></div></section>
    <Capabilities scope={scope} />
  </main>;
}
void connect();
createRoot(document.getElementById("root")!).render(<Fixture />);
