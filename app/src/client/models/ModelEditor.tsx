import {
  reasoningLevels as levels,
  type ModelDraft as Model,
  type ProviderDraft as Provider,
} from "../../shared/models.js";
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
        <h2 id="model-editor-heading">
          {p.models.some((m) => m.key === editor.key) ? "编辑模型" : "添加模型"}
        </h2>
        <div className="inline-model-fields">
          <div className="field">
            <label htmlFor="new-model-id">模型 ID</label>
            <input
              className="input num"
              id="new-model-id"
              autoFocus
              required
              maxLength={160}
              placeholder="供应商提供的模型 ID"
              value={editor.id}
              onChange={(e) => setEditor({ ...editor, id: e.target.value })}
            />
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
              选择模型支持的等级；再次点击可取消，未选时不配置思考等级。统一点击下方「保存」后生效。none
              对应 pi 的 off；保存时校验实际模型能力。
            </span>
          </div>
        </div>
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
          <p className="feedback" role="status">
            {feedback}
          </p>
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
        </div>
      </form>
    </section>
  );
}
