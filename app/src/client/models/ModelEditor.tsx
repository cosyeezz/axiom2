import {
  reasoningLevels as levels,
  modelCostKeys,
  emptyModelPricing,
  type ModelDraft as Model,
  type ProviderDraft as Provider,
} from "../../shared/models.js";
import { costPartLabels } from "../../shared/costs.js";
import { Icon } from "../Icon.js";
import { Headers, BodyOverrides } from "./Overrides.js";
export function ModelEditor({
  editor,
  setEditor,
  p,
  stageEditor,
  discardEditor,
  feedback,
}: {
  editor: Model;
  setEditor: (m: Model | null) => void;
  p: Provider;
  stageEditor: () => unknown;
  discardEditor: (proceed: () => void) => void;
  feedback: string;
}) {
  const idError = !editor.id.trim() ? "请填写供应商提供的模型 ID。" : p.models.some((model) => model.key !== editor.key && model.id === editor.id.trim()) ? "模型 ID 重复，请使用该供应商下唯一的模型 ID。" : "";
  return (
    <section
      className="inline-model-editor"
      id="model-editor"
      aria-labelledby="model-editor-heading"
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          stageEditor();
        }}
      >
        <div className="model-editor-heading">
          <h2 id="model-editor-heading">
            {p.models.some((m) => m.key === editor.key) ? "编辑模型" : "添加模型"}
          </h2>
          <span className="meta">完成编辑后，统一保存生效</span>
        </div>
        <div className="inline-model-fields">
          <div className="field">
            <label htmlFor="new-model-id">模型 ID</label>
            <input
              className="input num"
              id="new-model-id"
              autoFocus
              required
              aria-invalid={!!idError}
              aria-describedby={idError ? "model-id-error" : undefined}
              maxLength={160}
              placeholder="供应商提供的模型 ID"
              value={editor.id}
              onChange={(e) => setEditor({ ...editor, id: e.target.value })}
            />
            {idError && <span id="model-id-error" className="field-help">{idError}</span>}
          </div>
          <div className="field">
            <label htmlFor="new-model-name">显示名称</label>
            <input
              className="input"
              id="new-model-name"
              maxLength={80}
              placeholder="留空时使用模型 ID"
              value={editor.name}
              onChange={(e) => setEditor({ ...editor, name: e.target.value })}
            />
          </div>
          <div className="field model-input-field">
            <label id="model-input-label">输入能力 <span className="meta">（多模态）</span></label>
            <div className="model-input-options" role="group" aria-labelledby="model-input-label" aria-describedby="model-input-help">
              <div className="model-input-option model-input-required">
                <svg className="ui-glyph" aria-hidden="true" viewBox="3 4 18 16"><path d="M4 5h16M12 5v14M8 19h8" /></svg>
                <span className="model-input-copy"><strong>文本</strong><small>对话与代码</small></span>
                <span className="model-input-state">默认支持</span>
              </div>
              <label className="model-input-option" data-selected={editor.input?.includes("image") ?? false}>
                <input type="checkbox" name="model-input-image" checked={editor.input?.includes("image") ?? false}
                  onChange={(e) => setEditor({ ...editor, input: e.target.checked ? ["text", "image"] : ["text"] })} />
                <Icon name="image" />
                <span className="model-input-copy"><strong>图片</strong><small>理解图片内容</small></span>
                <span className="model-input-toggle" aria-hidden="true" />
              </label>
            </div>
            <span className="field-help" id="model-input-help">仅在模型支持图片理解时开启；当前支持文本与图片输入。</span>
          </div>
          <div className="field" id="model-reasoning-field">
            <label id="model-reasoning-label">
              思考等级 <span className="meta">（可多选）</span>
            </label>
            <div
              id="reasoning-level-options"
              role="group"
              aria-labelledby="model-reasoning-label"
              aria-describedby="reasoning-help"
            >
              {levels.map((level) => (
                <label key={level}>
                  <input
                    type="checkbox"
                    value={level}
                    name="model-reasoning-level"
                    checked={editor.levels.includes(level)}
                    onChange={(e) =>
                      setEditor({
                        ...editor,
                        levels: levels.filter((l) =>
                          l === level
                            ? e.target.checked
                            : editor.levels.includes(l),
                        ),
                      })
                    }
                  />
                  <span>{level}</span>
                </label>
              ))}
            </div>
            <span className="field-help" id="reasoning-help">
              选择模型支持的等级；再次点击可取消。至少保留一项，不使用思考时选择 none。
            </span>
          </div>
        </div>
        <section className="model-pricing" aria-labelledby="model-pricing-heading">
          <h3 id="model-pricing-heading">计费设置 <span className="meta">美元 / 百万 Token</span></h3>
          <p className="field-help" id="model-pricing-help">按供应商价格填写，用于预计费用统计。保存后从下一次执行生效，历史费用保留原记录。</p>
          <div className="model-pricing-fields">
            {modelCostKeys.map(key => (
              <div className="field" key={key}>
                <label htmlFor={`model-cost-${key}`}>{costPartLabels[key]}单价</label>
                <input className="input num" id={`model-cost-${key}`} type="number" min="0" step="any"
                  aria-describedby="model-pricing-help" placeholder="0" required={!!editor.cost}
                  value={editor.cost && Number.isFinite(editor.cost[key]) ? editor.cost[key] : ""}
                  onChange={event => setEditor({ ...editor, cost: { ...(editor.cost ?? emptyModelPricing()), [key]: event.target.valueAsNumber } })} />
              </div>
            ))}
          </div>
          <p className="field-help">统计需要接口返回 Token 用量。缺少价格或四项单价均为 0 时，费用无法确认，会显示为未知。</p>
          {editor.costTiered && <p className="field-help">此模型包含阶梯定价；这里编辑基础单价，已有阶梯价格继续生效。</p>}
        </section>
        <div className="override-grid">
          <Headers
            scope="model"
            rows={editor.headers}
            change={(headers) => setEditor({ ...editor, headers })}
          />
          <BodyOverrides
            rows={editor.body}
            change={(body) => setEditor({ ...editor, body })}
            api={p.api}
          />
        </div>
        <div className="inline-model-actions">
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => discardEditor(() => setEditor(null))}
          >
            取消
          </button>
          <button className="btn" type="submit">
            完成编辑
          </button>
          <p className="feedback" role="status">{feedback}</p>
        </div>
      </form>
    </section>
  );
}
