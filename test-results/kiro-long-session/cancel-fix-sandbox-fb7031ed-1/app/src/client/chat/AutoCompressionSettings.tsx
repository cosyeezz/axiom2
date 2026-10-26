import { useId, useRef, useState } from "react";
import {
  autoCompressionThreshold, compressionPreferencesScope,
  type AutoCompression, type CompressionPreferences,
} from "../../shared/compression.js";
import { command, useConnectionState, useScope } from "../transport.js";

export function AutoCompressionSettings({ contextWindow }: { contextWindow?: number | null }) {
  const preferences = useScope<CompressionPreferences | null>(compressionPreferencesScope, null);
  const connected = useConnectionState().connected;
  const [busy, setBusy] = useState(false);
  const [pendingEnabled, setPendingEnabled] = useState<boolean | null>(null);
  const [message, setMessage] = useState("");
  const settings = preferences?.auto;
  const toggle = async (enabled: boolean) => {
    setPendingEnabled(enabled);
    setBusy(true); setMessage("");
    try {
      await command("compression.preferences.save", { auto: { enabled } });
      setMessage("已全局保存，后续上下文用量检查时生效。");
    } catch (error) { setMessage((error as Error).message); }
    finally { setBusy(false); setPendingEnabled(null); }
  };
  const knownWindow = contextWindow != null && Number.isFinite(contextWindow) && contextWindow > 0;
  return <section className="auto-compression-settings" aria-label="自动压缩设置">
    <div className="row-between">
      <h3>自动压缩</h3>
      <label className="auto-compression-toggle">
        <input type="checkbox" checked={pendingEnabled ?? settings?.enabled ?? false} disabled={!connected || !settings || busy}
          onChange={(event) => void toggle(event.target.checked)} />
        <span>启用自动压缩</span>
      </label>
    </div>
    <p>上下文达到 Token 数或容量百分比时触发，两者取较小值。主／子会话分别计算，使用上方压缩模型。</p>
    <div className="auto-compression-fields">
      <ThresholdField name="tokens" label="Token 阈值" value={settings?.tokens} max={Number.MAX_SAFE_INTEGER} disabled={!connected} />
      <ThresholdField name="percent" label="上下文百分比（%）" value={settings?.percent} max={100} disabled={!connected} />
    </div>
    {settings && <p className="auto-compression-effective">
      {!settings.enabled ? "自动压缩已关闭，可随时手动压缩。" : knownWindow
        ? `当前会话生效阈值：${autoCompressionThreshold(settings, contextWindow).toLocaleString("zh-CN")} Token（${settings.tokens.toLocaleString("zh-CN")} 与 ${contextWindow!.toLocaleString("zh-CN")} × ${settings.percent}% 取小值）。`
        : `当前上下文容量尚未知，暂按 ${settings.tokens.toLocaleString("zh-CN")} Token 判断；容量可用后自动取较小值。`}
    </p>}
    <p>全局记忆，按 Enter 或移开焦点自动保存。后台生成摘要并在安全点应用；关闭开关不取消已开始的任务。</p>
    <p role="status">{!connected ? "连接断开，暂时无法保存。" : !settings ? "正在读取自动压缩设置…" : busy ? "保存中…" : message}</p>
  </section>;
}

function ThresholdField({ name, label, value, max, disabled }: {
  name: keyof Pick<AutoCompression, "tokens" | "percent">;
  label: string; value?: number; max: number; disabled: boolean;
}) {
  const id = useId();
  const [draft, setDraft] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const saving = useRef(false);
  const save = async (raw: string) => {
    if (saving.current || disabled || draft === null) return;
    const number = Number(raw);
    if (!raw.trim() || !Number.isSafeInteger(number) || number < 1 || number > max) {
      setMessage(name === "percent" ? "请输入 1–100 的整数，尚未保存。" : "请输入正安全整数，尚未保存。");
      return;
    }
    saving.current = true; setBusy(true); setMessage("");
    try {
      await command("compression.preferences.save", { auto: { [name]: number } });
      setDraft(null); setMessage("已全局保存");
    } catch (error) { setMessage((error as Error).message); }
    finally { saving.current = false; setBusy(false); }
  };
  return <div className="auto-compression-field">
    <label htmlFor={id}>{label}</label>
    <input id={id} className="input" type="number" min={1} max={max} step={1}
      value={draft ?? (value === undefined ? "" : String(value))}
      disabled={disabled || value === undefined || busy} aria-describedby={`${id}-status`}
      aria-invalid={message.includes("尚未保存") || undefined}
      onChange={(event) => { setDraft(event.target.value); setMessage(""); }}
      onBlur={(event) => void save(event.target.value)}
      onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); event.currentTarget.blur(); } }} />
    <p id={`${id}-status`} role="status">{busy ? "保存中…" : message}</p>
  </div>;
}
