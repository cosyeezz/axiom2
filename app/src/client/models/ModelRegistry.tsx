import type { ReactNode } from "react";
import type {
  ModelDraft as Model,
  ProviderDraft as Provider,
} from "../../shared/models.js";
import { Icon } from "../components.js";
import { ModelEditor } from "./ModelEditor.js";
export function ModelRegistry({
  p,
  tab,
  filter,
  setFilter,
  editor,
  setEditor,
  discardEditor,
  patch,
  feedback,
  setFeedback,
  copyFeedback,
  copyButton,
  rows,
  setDecision,
}: {
  p: Provider;
  tab: string;
  filter: string;
  setFilter: (s: string) => void;
  editor: Model | null;
  setEditor: (m: Model | null) => void;
  discardEditor: (fn: () => void) => void;
  patch: (p: Partial<Provider>) => void;
  feedback: string;
  setFeedback: (s: string) => void;
  copyFeedback: string;
  copyButton: (v: string, k: string) => ReactNode;
  rows: Model[];
  setDecision: (v: {
    title: string;
    text: string;
    proceed: () => void;
  }) => void;
}) {
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
          <p>仅显示当前供应商的模型，新增模型自动归属当前供应商。</p>
        </div>
        <div className="model-tools">
          <input
            className="input"
            type="search"
            placeholder="搜索模型名称或 ID"
            aria-label="搜索当前供应商的模型"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
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
      {editor && (
        <ModelEditor
          {...{ editor, setEditor, p, patch, feedback, setFeedback }}
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
              <th className="reasoning-col">思考设置</th>
              <th className="actions-col">操作</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((m) => (
              <tr key={m.key}>
                <td>
                  <div className="copyable-value">
                    <span className="model-name">{m.name}</span>
                    {copyButton(m.name, "模型名称")}
                  </div>
                  <div className="mobile-model-id">
                    <code>{m.id}</code>
                    {copyButton(m.id, "模型 ID")}
                  </div>
                  <span className="mobile-model-reasoning">
                    {m.levels.join(" / ") || "不设置"}
                  </span>
                </td>
                <td className="id-col">
                  <div className="copyable-value">
                    <code className="model-id">{m.id}</code>
                    {copyButton(m.id, "模型 ID")}
                  </div>
                </td>
                <td className="reasoning-col">
                  {m.levels.join(" / ") || "不设置"}
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
                      <svg aria-hidden="true" viewBox="0 0 24 24">
                        <path d="m16 3 5 5-12 12H4v-5Z" />
                      </svg>
                    </button>
                    <button
                      className="icon-btn"
                      aria-label={`删除模型：${m.name}`}
                      onClick={() =>
                        setDecision({
                          title: "删除模型草稿？",
                          text: m.originalId
                            ? "先移出草稿；顶部保存时会退出整个供应商，同供应商其他模型也可能需要重新认证。"
                            : "该模型尚未发布；仅从本页草稿移除。",
                          proceed: () => {
                            patch({
                              models: p.models.filter(
                                (item) => item.key !== m.key,
                              ),
                            });
                            if (editor?.key === m.key) setEditor(null);
                          },
                        })
                      }
                    >
                      <Icon name="close" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!rows.length && (
          <div className="model-empty">
            <strong>{filter ? "没有匹配的模型" : "当前供应商暂无模型"}</strong>
            点击「添加模型」创建未保存草稿。
          </div>
        )}
      </div>
      {!editor && (
        <p className="feedback" role="status">
          {feedback}
        </p>
      )}
      <p className="prototype-note">
        新增、编辑、删除及覆盖项均为草稿；「完成编辑」仅收起表单，顶部「保存」才发布。配置明确列出且
        pi 判定认证可用的模型才进入工作台列表。
      </p>
    </section>
  );
}
