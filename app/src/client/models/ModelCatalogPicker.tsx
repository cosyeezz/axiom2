import { useEffect, useRef, useState } from "react";
import { command } from "../transport.js";
import type { ModelCatalog, ModelDraft, ProviderDraft } from "../../shared/models.js";

export function ModelCatalogPicker({ provider, revision, blocked, add, close }: {
  provider: ProviderDraft;
  revision: string;
  blocked: boolean;
  add: (models: ModelDraft[]) => void;
  close: () => void;
}) {
  const [catalog, setCatalog] = useState<ModelCatalog | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(new Set<string>());
  const active = useRef(true);
  const started = useRef(false);
  const search = useRef<HTMLInputElement>(null);
  const load = async () => {
    setBusy(true);
    setError("");
    setCatalog(null);
    setSelected(new Set());
    try {
      const result = await command<ModelCatalog>("configuration.catalog", { providerId: provider.providerId, revision });
      if (!active.current) return;
      setCatalog(result);
      setSelected(new Set());
    } catch (e) {
      if (active.current) setError((e as Error).message);
    } finally {
      if (active.current) setBusy(false);
    }
  };
  useEffect(() => {
    active.current = true;
    search.current?.focus({ preventScroll: true });
    if (!started.current) { started.current = true; void load(); }
    return () => { active.current = false; };
  }, []);
  const existing = new Set(provider.models.map((model) => model.id));
  const rows = catalog?.models.filter((model) => `${model.name} ${model.id}`.toLowerCase().includes(query.toLowerCase())) ?? [];
  const eligible = (model: ModelCatalog["models"][number]) => !existing.has(model.id) && (provider.connectionType === "oauth" || model.api === provider.api);
  const choices = rows.filter(eligible);
  const picked = catalog?.models.filter((model) => selected.has(model.id) && eligible(model)) ?? [];
  const overflow = provider.models.length + picked.length > 1000;
  return (
    <section id="model-catalog-panel" className="model-catalog-panel" aria-labelledby="model-catalog-title" onKeyDown={(event) => {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(); }
    }}>
      <div className="row-between model-catalog-heading">
        <h3 id="model-catalog-title">选择模型 · {provider.name}</h3>
        <button type="button" className="btn btn-ghost" onClick={close}>收起列表</button>
      </div>
      <p className="field-help">选择模型加入当前供应商草稿，下方「保存」后生效。未知能力先按仅文本、不启用思考加入，请按模型实际能力编辑。</p>
      <div className="model-catalog-tools">
        <input ref={search} className="input" type="search" aria-label="搜索可添加模型" placeholder="搜索模型名称或 ID" value={query} onChange={(e) => setQuery(e.target.value)} />
        <button type="button" className="btn btn-ghost" disabled={busy || blocked} onClick={() => void load()}>{busy ? "正在拉取…" : "重新拉取"}</button>
      </div>
      <p role={error ? "alert" : "status"} className={error ? "auth-error" : "field-help"}>
        {error || (busy ? "正在读取供应商模型目录…" : catalog?.message)}
      </p>
      <div className="row-between model-catalog-selection">
        <span className="meta">{catalog ? `${rows.length} 个模型 · 已选 ${picked.length} 个` : error ? "模型列表读取失败" : "等待读取模型列表"}</span>
        <button type="button" className="btn btn-ghost" disabled={busy || blocked || !choices.length} onClick={() => {
          const allSelected = choices.every((model) => selected.has(model.id));
          setSelected((old) => {
            const next = new Set(old);
            for (const model of choices) allSelected ? next.delete(model.id) : next.add(model.id);
            return next;
          });
        }}>{choices.length > 0 && choices.every((model) => selected.has(model.id)) ? "取消当前筛选" : "选择当前筛选"}</button>
      </div>
      {blocked && <p className="field-help" role="status">配置有修改或正在同步；请先完成编辑并保存，再从目录添加模型。</p>}
      <div className="model-catalog-list" aria-label="供应商模型目录" aria-busy={busy}>
        {rows.map((model) => (
          <label key={model.id} className="model-catalog-item" data-disabled={!eligible(model)}>
            <input type="checkbox" aria-label={`选择模型：${model.name}`} checked={existing.has(model.id) || selected.has(model.id)} disabled={busy || blocked || !eligible(model)} onChange={(e) => {
              const checked = e.target.checked;
              setSelected((old) => { const next = new Set(old); checked ? next.add(model.id) : next.delete(model.id); return next; });
            }} />
            <span className="model-catalog-name"><strong>{model.name}</strong><code>{model.id}</code><span className="meta">{model.api} · 上下文 {model.contextWindow?.toLocaleString() ?? "待确认"} · {model.input ? (model.input.includes("image") ? "文本 + 图片" : "仅文本") : "输入能力待确认"}</span><span className="meta">思考：{model.levels?.join(", ") ?? "待确认"}</span></span>
            {existing.has(model.id) ? <span className="tag">已添加</span> : provider.connectionType !== "oauth" && model.api !== provider.api ? <span className="meta">需使用 {model.api} 协议</span> : null}
          </label>
        ))}
        {!busy && !error && catalog && !rows.length && <p className="model-empty">{query ? "没有匹配的模型，请调整搜索。" : provider.providerId === "kiro" ? "当前账号没有返回可列出的模型；请检查认证、权限及 profile。不会用静态名单或其他模型代替账号目录。" : "暂无可列出的模型；请检查连接和认证，或手动添加模型。"}</p>}
      </div>
      {overflow && <p role="alert" className="auth-error">每个供应商最多配置 1,000 个模型，请减少选择。</p>}
      <div className="model-catalog-actions">
        <button type="button" className="btn btn-primary" disabled={busy || blocked || !!error || !picked.length || overflow} onClick={() => {
          add(picked.map((model) => ({ key: crypto.randomUUID(), id: model.id, name: model.name, levels: [...(model.levels ?? ["none"])], input: [...(model.input ?? ["text"])], headers: [], body: [] })));
          close();
        }}>加入配置{picked.length ? `（${picked.length}）` : ""}</button>
        <span className="meta">已选 {picked.length} 个 · 加入后保存</span>
      </div>
    </section>
  );
}
