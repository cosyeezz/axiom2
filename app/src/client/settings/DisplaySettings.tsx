import { useState, useSyncExternalStore } from "react";
import { Select } from "../Select.js";
import { chooseTheme, useTheme, type Theme } from "../theme.js";
import { defaultDisplaySettings, displayRanges, getDisplaySettings, isDisplayStorageAvailable, setDisplaySettings, subscribeDisplaySettings } from "../display-settings.js";
import { FontSettings } from "./FontSettings.js";
import "../styles/display-settings.css";

const percent = (value: number) => `${Number(value.toFixed(1))}%`;
const themeOptions = [{ value: "light", label: "白天" }, { value: "dark", label: "黑夜" }];
export function DisplaySettings() {
  const settings = useSyncExternalStore(subscribeDisplaySettings, getDisplaySettings);
  const theme = useTheme();
  const [sample, setSample] = useState("正文清楚，行距舒展。字号、控件和留白保持协调。");
  const changeTheme = (value: Theme) => { void chooseTheme(value).catch(() => {}); };
  return <section className="display-settings" aria-labelledby="display-heading">
    <div className="display-heading"><div><h1 id="display-heading">显示与阅读</h1><p id="display-help">主题、字体、字号与间距即时生效。</p></div>
      <button type="button" className="btn" disabled={theme.busy} onClick={() => { setDisplaySettings(defaultDisplaySettings); changeTheme("dark"); }}>恢复默认</button></div>
    <div className="display-layout">
      <div className="display-controls">
        <h2 className="display-section-title">阅读偏好</h2>
        <div className="display-choice"><label htmlFor="display-theme">主题</label>
          <Select id="display-theme" label="主题" value={theme.current} options={themeOptions} disabled={theme.busy}
            onChange={value => changeTheme(value as Theme)} /></div>
        {theme.error && <p className="display-theme-error" role="alert">{theme.error}</p>}
        <FontSettings />
        {([ ["fontScale", "字号与间距"], ["brightness", "亮度"], ["contrast", "对比度"] ] as const).map(([key, label]) => <div className="display-control" key={key}>
          <label htmlFor={`display-${key}`}>{label}</label>
          {/* Leave pointer capture to the native thumb so it can handle continuous dragging. */}
          <input id={`display-${key}`} type="range" {...displayRanges[key]} value={settings[key]} aria-valuetext={percent(settings[key])} aria-describedby="display-help"
            onPointerDown={event => event.currentTarget.focus({ preventScroll: true })}
            onChange={event => setDisplaySettings({ [key]: Number(event.currentTarget.value) })} />
          <output htmlFor={`display-${key}`}>{percent(settings[key])}</output>
          <button type="button" className="display-reset" onClick={() => setDisplaySettings({ [key]: 100 })} aria-label={`重置${label}`}>重置</button>
        </div>)}
        <p className="display-scope">亮度与对比度仅调整应用配色，图片保持原色。</p>
      </div>
      <aside className="display-preview-panel" aria-label="效果预览">
      <div className="display-preview-heading"><div><h2 className="display-section-title">当前显示效果</h2><p className="font-help">随设置即时更新</p></div></div>
      <div className="display-preview-viewport" tabIndex={0} role="region" aria-label="显示效果实时预览，可滚动">
      <div className="display-preview" aria-label="显示效果实时预览">
        <span className="display-preview-label">阅读样张</span>
        <h2>让阅读更舒适</h2>
        <p className="display-preview-body font-sample">{sample || "让阅读更舒适，灵感从这里开始。"}</p>
        <p className="display-preview-secondary">辅助文字 · Aa Bb · 0123456789</p>
        <pre><code>const message = "你好，Axiom";</code></pre>
        <div className="display-preview-swatches" aria-label="从暗到亮的灰阶参考">{[0, 1, 2, 3, 4, 5].map(value => <span key={value} className={`display-gray-${value}`} />)}</div>
      </div></div>
      <details className="display-sample-editor">
        <summary>编辑预览文字</summary>
        <label htmlFor="display-preview-text" className="font-help">输入想试阅的文字</label>
        <textarea id="display-preview-text" className="textarea" rows={2} maxLength={500} value={sample} onChange={event => setSample(event.currentTarget.value)} />
      </details>
      </aside>
    </div>
    <footer className="display-footer">
      <p>Ctrl / ⌘ + 滚轮缩放 · Ctrl / ⌘ + 0 重置<span>Mac 也支持 Control + 滚轮</span></p>
      <p className="display-save-state" role="status">{isDisplayStorageAvailable() ? "自动保存在当前设备" : "本次已生效，当前浏览器无法保存设置"}</p>
    </footer>
  </section>;
}
