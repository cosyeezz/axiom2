import { useEffect, useState, useSyncExternalStore } from "react";
import { getDisplaySettings, setDisplaySettings, subscribeDisplaySettings } from "../display-settings.js";
import "../styles/display-settings.css";

// Shared by every page: do not import the display editor or its font catalog here.
export function FontScaleFeedback() {
  const settings = useSyncExternalStore(subscribeDisplaySettings, getDisplaySettings);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const show = () => { setVisible(true); clearTimeout(timer); timer = setTimeout(() => setVisible(false), 1800); };
    window.addEventListener("axiom:font-scale", show);
    return () => { window.removeEventListener("axiom:font-scale", show); clearTimeout(timer); };
  }, []);
  return <div className="font-scale-feedback" role="status" aria-live="polite" aria-atomic="true" hidden={!visible}>
    字号与间距 {Number(settings.fontScale.toFixed(1))}%{settings.fontScale === 50 ? " · 已到最小" : settings.fontScale === 200 ? " · 已到最大" : ""}
    <button type="button" onClick={() => setDisplaySettings({ fontScale: 100 })}>恢复 100%</button>
  </div>;
}
