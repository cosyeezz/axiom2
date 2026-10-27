import { useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { Icon } from "./Icon.js";
import { focusUsageControl, UsagePopup } from "./UsagePopup.js";
import { moveUsageDay, moveUsageMonth, parseUsageDay, usageCalendar, usageDatePreset, usageDay, usageMonth, usageRangeError, usageRangeLabel, type UsageDateRange, type UsageDatePreset } from "./usage-dates.js";

const presets: { id: UsageDatePreset; label: string }[] = [
  { id: "today", label: "今天" }, { id: "week", label: "近7天" }, { id: "month30", label: "近30天" }, { id: "month", label: "本月" }, { id: "all", label: "全部" },
];
function CalendarMark() {
  return <svg aria-hidden="true" className="ui-glyph" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><rect x="3" y="5" width="18" height="16" rx="3" /><path d="M7 3v4m10-4v4M3 11h18m-14 4h2m3 0h2m3 0h1" /></svg>;
}
function RangePanel({ initial, anchor, onApply, onClose, id }: { initial: UsageDateRange; anchor: HTMLButtonElement; id: string; onApply: (value: UsageDateRange) => void; onClose: () => void }) {
  const today = usageDay(new Date()), first = initial.from || initial.to || today;
  const [draft, setDraft] = useState(initial), [endpoint, setEndpoint] = useState<"from" | "to">("from");
  const [active, setActive] = useState(first), [month, setMonth] = useState(usageMonth(first));
  const grid = useRef<HTMLDivElement>(null), keyboardFocus = useRef(false);
  const error = usageRangeError(draft), days = usageCalendar(month), monthDate = parseUsageDay(month)!;
  const focusDay = (value: string) => { setActive(value); setMonth(usageMonth(value)); keyboardFocus.current = true; };
  useLayoutEffect(() => {
    if (!keyboardFocus.current) return;
    focusUsageControl(grid.current?.querySelector<HTMLButtonElement>(`[data-day="${active}"]`) ?? null);
    keyboardFocus.current = false;
  }, [active, month]);
  const edit = (key: "from" | "to", value: string) => {
    setDraft(previous => ({ ...previous, [key]: value }));
    if (parseUsageDay(value)) { setActive(value); setMonth(usageMonth(value)); }
  };
  const pick = (value: string) => {
    if (endpoint === "from") { setDraft({ from: value, to: draft.to && draft.to < value ? "" : draft.to }); setEndpoint("to"); }
    else { setDraft(draft.from && value < draft.from ? { from: value, to: draft.from } : { ...draft, to: value }); setEndpoint("from"); }
    setActive(value); setMonth(usageMonth(value)); keyboardFocus.current = true;
  };
  const key = (event: KeyboardEvent<HTMLButtonElement>, value: string) => {
    if (event.nativeEvent.isComposing || event.keyCode === 229 || event.altKey || event.metaKey || event.ctrlKey) return;
    const weekday = (parseUsageDay(value)!.getDay() + 6) % 7;
    let next: string;
    switch (event.key) {
      case "ArrowLeft": next = moveUsageDay(value, -1); break;
      case "ArrowRight": next = moveUsageDay(value, 1); break;
      case "ArrowUp": next = moveUsageDay(value, -7); break;
      case "ArrowDown": next = moveUsageDay(value, 7); break;
      case "Home": next = moveUsageDay(value, -weekday); break;
      case "End": next = moveUsageDay(value, 6 - weekday); break;
      case "PageUp": next = moveUsageMonth(value, event.shiftKey ? -12 : -1); break;
      case "PageDown": next = moveUsageMonth(value, event.shiftKey ? 12 : 1); break;
      default: return;
    }
    event.preventDefault(); focusDay(next);
  };
  const apply = (value: UsageDateRange) => { anchor.focus({ preventScroll: true }); onApply(value); onClose(); };
  return <UsagePopup anchor={anchor} id={id} label="选择日期范围" className="usage-date-panel" onClose={onClose} width={368}>
    <div className="usage-popup-heading"><strong>日期范围</strong><button className="usage-icon-button" type="button" aria-label="关闭日期选择" onClick={() => { anchor.focus({ preventScroll: true }); onClose(); }}><Icon name="x" /></button></div>
    <div className="usage-date-presets" aria-label="快捷日期范围">{presets.map(preset => <button type="button" key={preset.id} onClick={() => { const value = usageDatePreset(preset.id); setDraft(value); const next = value.from || today; setActive(next); setMonth(usageMonth(next)); }}>{preset.label}</button>)}</div>
    <div className="usage-date-inputs">{(["from", "to"] as const).map(part => <label key={part} data-active={endpoint === part || undefined}>
      <span>{part === "from" ? "开始日期" : "结束日期"}</span><input type="text" inputMode="text" placeholder="YYYY-MM-DD" maxLength={10} value={draft[part]} aria-label={part === "from" ? "开始日期" : "结束日期"}
        aria-invalid={!!error || undefined} onFocus={() => { setEndpoint(part); if (parseUsageDay(draft[part])) { setActive(draft[part]); setMonth(usageMonth(draft[part])); } }} onChange={event => edit(part, event.target.value)}
        onKeyDown={event => { if (event.key === "Enter" && !event.nativeEvent.isComposing) { event.preventDefault(); if (!error) apply(draft); } }} /></label>)}</div>
    <div className="usage-calendar-heading"><button type="button" className="usage-icon-button usage-calendar-prev" aria-label="上个月" disabled={month === "0001-01-01"} onClick={() => { const next = moveUsageMonth(active, -1); setMonth(usageMonth(next)); setActive(next); }}><Icon name="chevron-right" /></button>
      <strong aria-live="polite">{monthDate.getFullYear()}年{monthDate.getMonth() + 1}月</strong><button type="button" className="usage-icon-button" aria-label="下个月" disabled={month === "9999-12-01"} onClick={() => { const next = moveUsageMonth(active, 1); setMonth(usageMonth(next)); setActive(next); }}><Icon name="chevron-right" /></button></div>
    <div ref={grid} className="usage-calendar" role="grid" aria-multiselectable="true" aria-label={`${monthDate.getFullYear()}年${monthDate.getMonth() + 1}月`}>
      <div className="usage-calendar-week" role="row">{["一", "二", "三", "四", "五", "六", "日"].map(day => <span key={day} role="columnheader">{day}</span>)}</div>
      {Array.from({ length: 6 }, (_, week) => <div className="usage-calendar-week" role="row" key={week}>{days.slice(week * 7, week * 7 + 7).map((day, index) => {
        const selected = !!day && (day === draft.from || day === draft.to), inRange = !!day && !!draft.from && !!draft.to && day > draft.from && day < draft.to;
        return <span role="gridcell" key={day || `empty-${index}`} aria-selected={selected} className={inRange ? "is-in-range" : undefined}>
          {day && <button type="button" data-day={day} data-autofocus={day === active || undefined} tabIndex={day === active ? 0 : -1} aria-label={day} aria-current={day === today ? "date" : undefined}
            data-outside={usageMonth(day) !== month || undefined} data-selected={selected || undefined} onKeyDown={event => key(event, day)} onClick={() => pick(day)}>{Number(day.slice(-2))}</button>}</span>;
      })}</div>)}
    </div>
    <p className="usage-date-hint" role={error ? "alert" : undefined}>{error || `正在选择${endpoint === "from" ? "开始" : "结束"}日期 · 可留空以不限该侧范围`}</p>
    <div className="usage-date-footer"><button type="button" className="btn btn-ghost" onClick={() => apply({ from: "", to: "" })}>清空日期</button><button type="button" className="btn" disabled={!!error} onClick={() => apply(draft)}>确定日期</button></div>
  </UsagePopup>;
}
export function UsageDateRange({ id, value, onChange, disabled = false }: { id: string; value: UsageDateRange; onChange: (value: UsageDateRange) => void; disabled?: boolean }) {
  const trigger = useRef<HTMLButtonElement>(null), popupId = useId();
  const [open, setOpen] = useState(false), expanded = open && !disabled;
  return <>
    <button ref={trigger} type="button" id={id} className="input usage-date-trigger" aria-label="日期范围" aria-haspopup="dialog" aria-expanded={expanded} aria-controls={expanded ? popupId : undefined} disabled={disabled}
      onClick={() => { trigger.current?.focus({ preventScroll: true }); setOpen(previous => !previous); }}><CalendarMark /><span>{usageRangeLabel(value)}</span><Icon name="chevron-down" /></button>
    {expanded && trigger.current && <RangePanel id={popupId} anchor={trigger.current} initial={value} onApply={onChange} onClose={() => setOpen(false)} />}
  </>;
}
