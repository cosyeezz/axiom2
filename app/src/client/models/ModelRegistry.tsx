import { useRef, useState, type ReactNode } from "react";
import type {
  ModelDraft as Model,
  ProviderDraft as Provider,
} from "../../shared/models.js";
import { Icon } from "../components.js";
import { DeleteButton } from "../DeleteButton.js";
import { ModelEditor } from "./ModelEditor.js";
import { ModelCatalogPicker } from "./ModelCatalogPicker.js";
export function ModelRegistry({
  p,
  revision,
  dirty,
  busy,
  needsReconcile,
  tab,
  filter,
  setFilter,
  editor,
  setEditor,
  discardEditor,
  stageEditor,
  patch,
  feedback,
  copyFeedback,
  copyButton,
  rows,
  setDecision,
}: {
  p: Provider;
  revision: string;
  dirty: boolean;
  busy: boolean;
  needsReconcile: boolean;
  tab: string;
  filter: string;
  setFilter: (s: string) => void;
  editor: Model | null;
  setEditor: (m: Model | null) => void;
  discardEditor: (fn: () => void) => void;
  stageEditor: () => unknown;
  patch: (p: Partial<Provider>) => void;
  feedback: string;
  copyFeedback: string;
  copyButton: (v: string, k: string) => ReactNode;
  rows: Model[];
  setDecision: (v: {
    title: string;
    text: string;
    proceed: () => void;
  }) => void;
}) {
  const [catalogOpen, setCatalogOpen] = useState(false);
  const search = useRef<HTMLInputElement>(null);
  const catalogTrigger = useRef<HTMLButtonElement>(null);
  const closeCatalog = () => {
    setCatalogOpen(false);
    requestAnimationFrame(() => {
      (catalogTrigger.current?.disabled ? search.current : catalogTrigger.current)?.focus({ preventScroll: true });
    });
  };
  const catalogBlocked = !p.originalId || dirty || !!editor || busy || needsReconcile;
  const remove = (model: Model) => {
    patch({ models: p.models.filter((item) => item.key !== model.key) });
    if (editor?.key === model.key) setEditor(null);
  };
  return (
    <section
      className="model-registry"
      id="models-screen"
      role="tabpanel"
      aria-labelledby="models-tab"
      hidden={tab !== "models"}
    >
      <div className="row-between model-heading">
        <div>
          <h3>
            模型列表 <span className="meta num">{p.models.length}</span>
          </h3>
          <p>选择目录中的模型，或手动添加；保存后生效。</p>
        </div>
        <div className="model-tools">
          <input
            className="input"
            ref={search}
            type="search"
            placeholder="搜索模型名称或 ID"
            aria-label="搜索当前供应商的模型"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
          <button ref={catalogTrigger} className="btn btn-ghost" type="button" aria-expanded={catalogOpen} aria-controls={catalogOpen ? "model-catalog-panel" : undefined} disabled={!catalogOpen && catalogBlocked} onClick={() => catalogOpen ? closeCatalog() : setCatalogOpen(true)}>
            拉取模型列表
          </button>
          <button
            className="btn"
            id="add-model"
            onClick={() =>
              discardEditor(() =>
                setEditor({
                  key: crypto.randomUUID(),
                  id: "",
                  name: "",
                  levels: ["none"],
                  input: ["text"],
                  headers: [],
                  body: [],
                }),
              )
            }
          >
            <Icon name="plus" />
            添加模型
          </button>
        </div>
      </div>
      {catalogBlocked && <p className="field-help">拉取列表前请先保存或放弃配置修改，并完成当前模型编辑。</p>}
      {catalogOpen && (
        <ModelCatalogPicker key={`${p.id}:${revision}`} provider={p} revision={revision} blocked={catalogBlocked} close={closeCatalog} add={(models) => {
          const existing = new Set(p.models.map((model) => model.id));
          patch({ models: [...p.models, ...models.filter((model) => !existing.has(model.id))] });
        }} />
      )}
      {editor && (
        <ModelEditor
          {...{ editor, setEditor, p, stageEditor, discardEditor, feedback }}
        />
      )}
      <div className="card model-table">
        <table
          className="ds-table"
          id="configured-model-table"
          aria-label="当前供应商的模型"
        >
          <caption
            id="model-copy-feedback"
            role="status"
            aria-live="polite"
            aria-atomic="true"
          >
            {copyFeedback}
          </caption>
          <thead>
            <tr>
              <th className="name-col">显示名称</th>
              <th className="id-col">模型 ID</th>
              <th className="reasoning-col">思考等级</th>
              <th className="actions-col">操作</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((m) => (
              <tr key={m.key} data-editing={editor?.key === m.key}>
                <td>
                  <div className="copyable-value">
                    <span className="model-name">{m.name}</span>
                    {copyButton(m.name, "模型名称")}
                  </div>
                  <div className="mobile-model-id">
                    <code>{m.id}</code>
                    {copyButton(m.id, "模型 ID")}
                  </div>
                  <span className="model-input-summary" aria-label="输入能力">
                    {m.input?.includes("image") ? "文本 + 图片" : "仅文本"}
                  </span>
                  <span className="mobile-model-reasoning">
                    思考：{m.levels.join(", ") || "不设置"}
                  </span>
                </td>
                <td className="id-col">
                  <div className="copyable-value">
                    <code className="model-id">{m.id}</code>
                    {copyButton(m.id, "模型 ID")}
                  </div>
                </td>
                <td className="reasoning-col">
                  {m.levels.join(", ") || "不设置"}
                </td>
                <td>
                  <div className="model-actions">
                    <button
                      className="icon-btn"
                      aria-label={`编辑模型：${m.name}`}
                      onClick={() =>
                        discardEditor(() => setEditor(structuredClone(m)))
                      }
                    >
                      <Icon name="square-pen" />
                    </button>
                    <DeleteButton
                      label={`删除模型：${m.name}`}
                      title="删除模型草稿"
                      onDelete={() => remove(m)}
                      onConfirm={() =>
                        setDecision({
                          title: "删除模型草稿？",
                          text: m.originalId
                            ? "先移出草稿；保存时会退出整个供应商，同供应商其他模型也可能需要重新认证。"
                            : "该模型尚未发布；仅从本页草稿移除。",
                          proceed: () => remove(m),
                        })
                      }
                    />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!rows.length && (
          <div className="model-empty">
            <strong>{filter ? "没有匹配的模型" : "当前供应商暂无模型"}</strong>
            {filter ? <><span>试试其他名称或模型 ID。</span><button type="button" className="btn btn-ghost" onClick={() => { setFilter(""); search.current?.focus(); }}>清除搜索</button></> : "从模型目录选择，或点击「添加模型」手动填写。"}
          </div>
        )}
      </div>
      {!editor && (
        <p className="feedback" role="status">
          {feedback}
        </p>
      )}
      <p className="prototype-note">
        「完成编辑」仅暂存，下方「保存」后发布。已配置且认证可用的模型会出现在工作台。
      </p>
    </section>
  );
}
