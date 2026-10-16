import { useCallback, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { command, useConnection, useScope } from "../transport.js";
import { taskPreferencesScope, type TaskPreferences } from "../../shared/tasks.js";
import type { Selection } from "../../shared/agent.js";
import { Icon } from "../components.js";
import { ModelPicker } from "../chat/ModelPicker.js";
import { useSettingsPopover } from "../useSettingsPopover.js";

export function TaskSettings() {
  const [open, setOpen] = useState(false);
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  return <>
    <button ref={trigger} type="button" className="compression-trigger subagent-trigger"
      data-od-id="subagent-settings-trigger" aria-label="子代理设置" data-tooltip="子代理设置"
      aria-haspopup="dialog" aria-expanded={open} aria-controls={id} popoverTarget={id}
      onClick={(e) => { e.preventDefault(); setOpen((value) => !value); }}>
      <svg viewBox="1 1 22 22" aria-hidden="true">
        <rect x="9" y="2" width="6" height="6" rx="1" />
        <path d="M12 8v4M5 16v-4h14v4" />
        <rect x="2" y="16" width="6" height="6" rx="1" />
        <rect x="16" y="16" width="6" height="6" rx="1" />
      </svg>
    </button>
    {open && <SettingsDialog id={id} trigger={trigger.current!} onClose={() => setOpen(false)} />}
  </>;
}
function SettingsDialog({ id, trigger, onClose }: { id: string; trigger: HTMLButtonElement; onClose: () => void }) {
  const preferences = useScope<TaskPreferences | null>(taskPreferencesScope, null);
  const connected = useConnection() === "已连接本地服务";
  const { panel, close, host } = useSettingsPopover(trigger, onClose);
  const [message, setMessage] = useState("");
  const saveModel = useCallback(async (selection: Selection | null) => {
    setMessage("");
    await command("task.preferences.save", { selection });
    setMessage("已全局保存，新的委派立即使用此选择。");
  }, []);
  return createPortal(<dialog ref={panel} open popover="auto" id={id} className="compression-page subagent-settings"
    aria-labelledby={`${id}-heading`} aria-describedby={`${id}-note`}
    onKeyDown={(e) => {
      e.stopPropagation();
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") e.preventDefault();
    }}>
    <header>
      <div><h2 id={`${id}-heading`}>子代理设置</h2><p id={`${id}-note`}>全局记忆 · 自动保存 · 实时生效</p></div>
      <button ref={close} className="icon-btn" type="button" aria-label="关闭子代理设置" data-tooltip="返回会话（Esc）" onClick={onClose}><Icon name="close" /></button>
    </header>
    <div className="compression-body">
      <section className="compression-settings" aria-label="默认子模型设置">
        <h3>默认模型与思考等级</h3>
        <ModelPicker childDefault value={preferences?.selection ?? null} onDefaultSelect={saveModel} disabled={!connected || !preferences} />
        <p className="meta">用于所有工作空间的新委派；继承时使用主会话模型。不会中断当前请求或覆盖已有子会话的独立选择。</p>
      </section>
      <section aria-label="子代理运行设置">
        <h3>运行设置</h3>
        <div className="auto-compression-fields">
          <BudgetField label="同时运行的子任务" name="concurrency" value={preferences?.budgets.concurrency} min={1} max={16} disabled={!connected}
            hint="立即调整现有队列；降低上限不会强停正在运行的任务。" />
          <BudgetField label="工作时限（秒）" name="workMs" value={preferences ? preferences.budgets.workMs / 1000 : undefined} min={1} max={86400} scale={1000} disabled={!connected}
            hint="立即更新工作时限；有效追加重新计时。到期进入无工具总结，最多 3 分钟后强停；修改设置不延长已开始的总结。" />
        </div>
        <p>子代理可并行调研与执行测试，代码修改由主代理完成。</p>
      </section>
      <p role="status" className="meta">{!connected ? "连接断开，暂时无法保存设置。" : !preferences ? "正在读取全局设置…" : message}</p>
    </div>
    <footer><small>设置保存在本机服务，跨会话、工作空间与窗口共享，刷新或重启后保留。</small></footer>
  </dialog>, host);
}
function BudgetField({ label, name, value, min, max, scale = 1, disabled, hint }: {
  label: string; name: "concurrency" | "workMs"; value?: number; min: number; max: number; scale?: number; disabled: boolean; hint: string;
}) {
  const id = useId();
  const [draft, setDraft] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const revision = useRef(0);
  const text = draft ?? (value === undefined ? "" : String(value));
  const save = async (raw: string) => {
    const version = ++revision.current;
    const number = Number(raw);
    if (!raw.trim() || !Number.isInteger(number) || number < min || number > max) {
      setMessage(`请输入 ${min}–${max} 的整数，尚未保存。`);
      return;
    }
    setBusy(true); setMessage("");
    try {
      await command("task.preferences.save", { budgets: { [name]: number * scale } });
      if (revision.current === version) { setDraft(null); setMessage("已全局保存并生效"); }
    } catch (e) { if (revision.current === version) setMessage((e as Error).message); }
    finally { if (revision.current === version) setBusy(false); }
  };
  return <div className="auto-compression-field subagent-budget-field">
    <label htmlFor={id}>{label}</label>
    <input id={id} className="input" type="number" min={min} max={max} step="1" value={text}
      disabled={disabled || value === undefined || busy} aria-describedby={`${id}-hint ${id}-status`}
      onChange={(e) => { setDraft(e.target.value); setMessage(""); }}
      onBlur={(e) => { if (draft !== null) void save(e.target.value); }}
      onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); e.currentTarget.blur(); } }} />
    <p id={`${id}-hint`} className="meta">{hint} 输入完成后按 Enter 或移开焦点自动保存。</p>
    <p id={`${id}-status`} className="meta" role="status">{busy ? "保存中…" : message}</p>
  </div>;
}
