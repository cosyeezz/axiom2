import { useEffect, useId, useRef, useState } from "react";
import { Icon } from "./Icon.js";
import { UsagePopup } from "./UsagePopup.js";
import { normalizeUsageView, readUsageView, usageColumnDescriptions, usageColumns, usageViewKey, type UsageView } from "./usage-fields.js";

export function useUsageView(): readonly [UsageView, (next: UsageView) => void] {
  const read = () => { try { return readUsageView(localStorage); } catch { return normalizeUsageView(undefined); } };
  const [view, setView] = useState(read);
  useEffect(() => {
    const changed = (event: StorageEvent) => { if (event.key === usageViewKey || event.key === null) setView(read()); };
    window.addEventListener("storage", changed);
    return () => window.removeEventListener("storage", changed);
  }, []);
  const change = (next: UsageView) => {
    const normalized = normalizeUsageView(next); setView(normalized);
    try { localStorage.setItem(usageViewKey, JSON.stringify(normalized)); } catch { /* Keep controls usable when storage is blocked. */ }
  };
  return [view, change];
}
export function UsageColumns({ value, onChange }: { value: UsageView; onChange: (next: UsageView) => void }) {
  const trigger = useRef<HTMLButtonElement>(null), id = useId(), [open, setOpen] = useState(false);
  return <>
    <button ref={trigger} type="button" className="btn btn-ghost usage-columns-trigger" aria-label="显示字段" aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? id : undefined}
      onClick={() => { trigger.current?.focus({ preventScroll: true }); setOpen(previous => !previous); }}><Icon name="columns-2" /><span>显示字段</span><small>{value.columns.length}/{usageColumns.length}</small></button>
    {open && trigger.current && <UsagePopup anchor={trigger.current} id={id} label="设置显示字段" className="usage-columns-panel" width={400} onClose={() => setOpen(false)}>
      <div className="usage-popup-heading"><strong>显示字段</strong><button type="button" className="usage-icon-button" aria-label="关闭字段设置" data-autofocus onClick={() => { trigger.current?.focus({ preventScroll: true }); setOpen(false); }}><Icon name="x" /></button></div>
      <fieldset className="usage-density"><legend>列表密度</legend>{(["compact", "comfortable"] as const).map(density => <label key={density}>
        <input type="radio" name={`${id}-density`} value={density} checked={value.density === density} onChange={() => onChange({ ...value, density })} /><span>{density === "compact" ? "紧凑" : "舒适"}</span></label>)}</fieldset>
      {["基本信息", "Token 用量", "费用信息"].map(group => <fieldset className="usage-column-group" key={group}><legend>{group}</legend><div>
        {usageColumns.filter(column => column.group === group).map(column => <label key={column.id} title={usageColumnDescriptions[column.id]}>
          <input type="checkbox" checked={value.columns.includes(column.id)} disabled={value.columns.length === 1 && value.columns[0] === column.id}
            onChange={event => onChange({ ...value, columns: event.target.checked ? [...value.columns, column.id] : value.columns.filter(id => id !== column.id) })} /><span>{column.label}</span></label>)}
      </div></fieldset>)}
      <p className="usage-columns-hint">至少保留一个字段。设置仅保存在当前浏览器，不改变筛选与账务统计。</p>
      <div className="usage-columns-footer"><button type="button" className="btn btn-ghost" onClick={() => onChange({ ...value, columns: usageColumns.map(column => column.id) })}>显示全部</button><button type="button" className="btn btn-ghost" onClick={() => onChange(normalizeUsageView(undefined))}>恢复默认</button></div>
    </UsagePopup>}
  </>;
}
