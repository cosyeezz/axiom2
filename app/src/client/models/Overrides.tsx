import { DeleteIcon } from "../DeleteIcon.js";
import { samplingKeys, type OverrideRow as Row } from "../../shared/models.js";
export function Headers({
  rows,
  change,
  scope,
}: {
  rows: Row[];
  change: (rows: Row[]) => void;
  scope: string;
}) {
  return (
    <section
      className="override-editor"
      aria-label={`${scope === "model" ? "模型" : "供应商"}请求头覆盖`}
    >
      <div className="override-heading">
        <h3>请求头覆盖</h3>
        <button
          className="btn btn-ghost"
          type="button"
          disabled={rows.length >= 100}
          onClick={() =>
            change([...rows, { id: crypto.randomUUID(), key: "", value: "" }])
          }
        >
          ＋ 添加一项
        </button>
      </div>
      <div className="override-rows">
        {rows.map((row, i) => (
          <div className="override-row" key={row.id}>
            <input
              className="input"
              aria-label={`第 ${i + 1} 项 key`}
              placeholder="key"
              maxLength={160}
              autoComplete="off"
              value={row.key}
              onChange={(e) =>
                change(
                  rows.map((r) =>
                    r.id === row.id
                      ? { ...r, key: e.target.value, keep: false }
                      : r,
                  ),
                )
              }
            />
            <input
              className="input override-value"
              aria-label={`第 ${i + 1} 项 value`}
              placeholder={row.keep ? "已保存；留空保留，输入替换" : "value"}
              maxLength={8192}
              autoComplete="off"
              value={row.value}
              onChange={(e) =>
                change(
                  rows.map((r) =>
                    r.id === row.id
                      ? { ...r, value: e.target.value, keep: false }
                      : r,
                  ),
                )
              }
            />
            <button
              className="icon-btn"
              type="button"
              aria-label={`删除第 ${i + 1} 项`}
              onClick={() => change(rows.filter((r) => r.id !== row.id))}
            >
              <DeleteIcon />
            </button>
          </div>
        ))}
        {!rows.length && <p className="override-empty">未设置覆盖项</p>}
      </div>
      <p className="field-help">模型优先；草稿和敏感值不写入浏览器存储。</p>
    </section>
  );
}
export function BodyOverrides({
  rows,
  change,
  api,
}: {
  rows: Row[];
  change: (rows: Row[]) => void;
  api: string;
}) {
  const supported = [
    "openai-completions",
    "openai-responses",
    "azure-openai-responses",
  ].includes(api);
  return (
    <section className="override-editor" aria-label="请求体覆盖">
      <div className="override-heading">
        <h3>请求体覆盖</h3>
        <button
          type="button"
          className="btn btn-ghost"
          disabled={!supported || rows.length >= 30}
          onClick={() =>
            change([
              ...rows,
              { id: crypto.randomUUID(), key: "temperature", value: "1" },
            ])
          }
        >
          ＋ 添加一项
        </button>
      </div>
      <div className="override-rows">
        {rows.map((r, i) => (
          <div className="override-row" key={r.id}>
            <select
              className="input"
              aria-label={`第 ${i + 1} 项请求体字段`}
              value={r.key}
              onChange={(e) =>
                change(
                  rows.map((row) =>
                    row.id === r.id ? { ...row, key: e.target.value } : row,
                  ),
                )
              }
            >
              {samplingKeys.map((key) => (
                <option key={key}>{key}</option>
              ))}
            </select>
            <input
              className="input override-value"
              type="number"
              step="any"
              aria-label={`第 ${i + 1} 项请求体值`}
              value={r.value}
              onChange={(e) =>
                change(
                  rows.map((row) =>
                    row.id === r.id ? { ...row, value: e.target.value } : row,
                  ),
                )
              }
            />
            <button
              type="button"
              className="icon-btn"
              aria-label={`删除第 ${i + 1} 项请求体覆盖`}
              onClick={() => change(rows.filter((row) => row.id !== r.id))}
            >
              <DeleteIcon />
            </button>
          </div>
        ))}
      </div>
      {!rows.length && <p className="override-empty">未设置覆盖项</p>}
      <p className="field-help">
        {supported
          ? "映射 pi samplingParams；供应商项保存时落实到各模型，模型项优先。其他已有字段保留在服务端。"
          : "当前协议不支持采样请求体覆盖；不可保存后静默忽略。"}
      </p>
    </section>
  );
}
