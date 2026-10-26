import { Select } from "../Select.js";
import { ComboInput } from "../ComboInput.js";
import { DeleteIcon } from "../DeleteIcon.js";
import { bodyOverrideType, samplingKeys, type BodyOverrideType, type OverrideRow as Row } from "../../shared/models.js";

const headerNames = ["Authorization", "Content-Type", "Accept", "OpenAI-Organization", "OpenAI-Project", "OpenAI-Beta", "x-api-key", "anthropic-version", "anthropic-beta", "User-Agent"];
const headerValues: Record<string, string[]> = {
  "content-type": ["application/json"],
  accept: ["application/json", "text/event-stream"],
  authorization: ["Bearer "],
  "openai-beta": ["assistants=v2"],
  "anthropic-version": ["2023-06-01"],
};
const bodyNames = ["service_tier", "model", ...samplingKeys, "tool_choice", "user", "prompt_cache_key"];
const bodyValues: Record<string, string[]> = {
  service_tier: ["default", "auto", "fast", "ultrafast", "priority", "flex"],
  temperature: ["0", "0.5", "1"],
  top_p: ["0.9", "1"],
  min_p: ["0", "0.1"],
  presence_penalty: ["0", "1"],
  frequency_penalty: ["0", "1"],
  tool_choice: ["auto", "none", "required"],
};

const suggestions = (values: Record<string, string[]>, key: string) => Object.hasOwn(values, key) ? values[key] : [];

export function Headers({ rows, change, scope }: {
  rows: Row[]; change: (rows: Row[]) => void; scope: string;
}) {
  return (
    <section className="override-editor" aria-label={`${scope === "model" ? "模型" : "供应商"}请求头覆盖`}>
      <div className="override-heading">
        <h3>请求头覆盖</h3>
        <button className="btn btn-ghost" type="button" disabled={rows.length >= 100}
          onClick={() => change([...rows, { id: crypto.randomUUID(), key: "", value: "" }])}>
          ＋ 添加一项
        </button>
      </div>
      <div className="override-rows">
        {rows.map((row, i) => (
          <div className="override-row" key={row.id}>
            <ComboInput label={`第 ${i + 1} 项 key`} placeholder="选择或输入请求头名称" maxLength={160}
              options={headerNames} value={row.key}
              onChange={key => change(rows.map(r => r.id === row.id && r.key !== key ? { ...r, key, keep: false } : r))} />
            <ComboInput className="override-value" label={`第 ${i + 1} 项 value`} placeholder={row.keep ? "已保存，留空保留" : "选择或输入请求头值"}
              maxLength={8192} options={suggestions(headerValues, row.key.toLowerCase())} value={row.value}
              onChange={value => change(rows.map(r => r.id === row.id ? { ...r, value, keep: false } : r))} />
            <button className="icon-btn" type="button" aria-label={`删除第 ${i + 1} 项`}
              onClick={() => change(rows.filter(r => r.id !== row.id))}>
              <DeleteIcon />
            </button>
          </div>
        ))}
        {!rows.length && <p className="override-empty">未设置覆盖项</p>}
      </div>
      <p className="field-help">名称和值可选择常用项或自由输入。模型设置优先；已保存的值留空保留，输入新值替换。</p>
    </section>
  );
}

export function BodyOverrides({ rows, change, api }: {
  rows: Row[]; change: (rows: Row[]) => void; api: string;
}) {
  const supported = ["openai-completions", "openai-responses", "azure-openai-responses"].includes(api);
  return (
    <section className="override-editor" aria-label="请求体覆盖">
      <div className="override-heading">
        <h3>请求体覆盖</h3>
        <button type="button" className="btn btn-ghost" disabled={!supported || rows.length >= 30}
          onClick={() => change([...rows, { id: crypto.randomUUID(), key: "", value: "", valueType: "string" }])}>
          ＋ 添加一项
        </button>
      </div>
      <div className="override-rows">
        {rows.map((r, i) => (
          <div className="override-row" key={r.id}>
            <ComboInput label={`第 ${i + 1} 项请求体字段`} value={r.key} options={bodyNames} maxLength={100} placeholder="选择或输入字段名称"
              onChange={key => change(rows.map(row => row.id === r.id && row.key !== key ? { ...row, key, valueType: bodyOverrideType(key) } : row))} />
            <div className="override-value override-typed-value">
              <Select label={`第 ${i + 1} 项请求体值类型`} value={r.valueType ?? bodyOverrideType(r.key)}
                options={[{ value: "string", label: "文本" }, { value: "number", label: "数字" }]}
                onChange={valueType => change(rows.map(row => row.id === r.id ? { ...row, valueType: valueType as BodyOverrideType } : row))} />
              <ComboInput label={`第 ${i + 1} 项请求体值`} value={r.value} options={suggestions(bodyValues, r.key)} maxLength={8192}
                placeholder={(r.valueType ?? bodyOverrideType(r.key)) === "number" ? "输入数字" : "输入文本，无需引号"}
                onChange={value => change(rows.map(row => row.id === r.id ? { ...row, value } : row))} />
            </div>
            <button type="button" className="icon-btn" aria-label={`删除第 ${i + 1} 项请求体覆盖`}
              onClick={() => change(rows.filter(row => row.id !== r.id))}>
              <DeleteIcon />
            </button>
          </div>
        ))}
      </div>
      {!rows.length && <p className="override-empty">未设置覆盖项</p>}
      <p className="field-help">
        {supported
          ? "名称和值可选择常用项或自由输入。文本按原样发送，数字按数值发送；模型设置优先于供应商设置。"
          : "当前协议不支持请求体覆盖，请移除覆盖项或切换协议后保存。"}
      </p>
    </section>
  );
}
