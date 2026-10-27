import { memo, type ReactNode } from "react";
import { modelCostKeys, type ModelDraft as Model } from "../../shared/models.js";
import { Icon } from "../components.js";
import { DeleteButton } from "../DeleteButton.js";

// Keep rows mounted (including focus and delete timers), but do not rebuild
// every row for connection fields, feedback, tabs, or editor keystrokes.
export const ModelRows = memo(function ModelRows({
  rows, editingKey, copyButton, duplicate, edit, remove, confirmRemove,
}: {
  rows: Model[];
  editingKey: string | undefined;
  copyButton: (value: string, kind: string) => ReactNode;
  duplicate: (model: Model) => void;
  edit: (model: Model) => void;
  remove: (model: Model) => void;
  confirmRemove: (model: Model) => void;
}) {
  return (
    <tbody>
      {rows.map((m) => (
        <tr key={m.key} data-editing={editingKey === m.key}>
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
            <span className="model-input-summary" aria-label="计费状态">
              {m.cost && modelCostKeys.some(key => m.cost![key] > 0) ? "已设置计费单价" : "计费价格未知 · 编辑模型设置"}
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
                type="button"
                className="icon-btn"
                aria-label={`复制模型配置：${m.name}`}
                title="复制模型配置"
                onClick={() => duplicate(m)}
              >
                <Icon name="copy" />
              </button>
              <button
                className="icon-btn"
                aria-label={`编辑模型：${m.name}`}
                onClick={() => edit(m)}
              >
                <Icon name="square-pen" />
              </button>
              <DeleteButton
                label={`删除模型：${m.name}`}
                title="删除模型草稿"
                onDelete={() => remove(m)}
                onConfirm={() => confirmRemove(m)}
              />
            </div>
          </td>
        </tr>
      ))}
    </tbody>
  );
});
