import type { ModelDraft } from "../../shared/models.js";

export function copyModelDraft(source: ModelDraft, models: ModelDraft[]): ModelDraft {
  const base = (source.name || source.id).replace(/（复制(?: \d+)?）$/, "");
  const names = new Set(models.map(model => model.name));
  let name = "";
  for (let index = 1; ; index++) {
    const suffix = index === 1 ? "（复制）" : `（复制 ${index}）`;
    name = base.slice(0, 160 - suffix.length) + suffix;
    if (!names.has(name)) break;
  }
  const key = crypto.randomUUID();
  const copy = structuredClone(source);
  delete copy.originalId;
  return {
    ...copy,
    key,
    configId: `axiom-copy-${key}`,
    copyFromId: source.originalId ?? source.copyFromId,
    name,
  };
}
