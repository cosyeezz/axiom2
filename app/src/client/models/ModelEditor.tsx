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
  patch,
  feedback,
  setFeedback,
}: {
  editor: Model;
  setEditor: (m: Model | null) => void;
  p: Provider;
  patch: (p: Partial<Provider>) => void;
  feedback: string;
  setFeedback: (s: string) => void;
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
          if (!editor.id.trim()) return;
          if (
            p.models.some(
              (m) => m.key !== editor.key && m.id === editor.id.trim(),
            )
          ) {
            setFeedback("模型 ID 不能重复");
            return;
          }
          const m = {
            ...editor,
            id: editor.id.trim(),
            name: editor.name.trim() || editor.id.trim(),
          };
          patch({
            models: [...p.models.filter((old) => old.key !== m.key), m],
          });
          setEditor(null);
          setFeedback("已结束行内编辑；仍是未保存草稿。");
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
            <span className="field-help">
              多选模型支持的等级；none 对应 pi 的 off。保存时映射
              thinkingLevelMap；会话每次只选择一个等级。
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
            onClick={() => setEditor(null)}
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
