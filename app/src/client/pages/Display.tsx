import { useState, type CSSProperties } from "react";
import { SettingsSidebar } from "../components.js";
import { getDisplaySettings } from "../display-settings.js";
import { SettingsHeader } from "../settings/SettingsHeader.js";
import { DisplaySettings } from "../settings/DisplaySettings.js";
import "../styles/settings.css";

export default function Display() {
  // Keep the editor steady while dragging, without shrinking the saved reading size on entry.
  const [editorScale] = useState(() => getDisplaySettings().fontScale / 100);
  return <div className="settings-app display-app" style={{ "--display-editor-scale": editorScale } as CSSProperties}>
    <SettingsSidebar page="display" />
    <main className="settings-main display-main" id="content">
      <SettingsHeader page="display" />
      <div className="display-page"><DisplaySettings /></div>
    </main>
  </div>;
}
