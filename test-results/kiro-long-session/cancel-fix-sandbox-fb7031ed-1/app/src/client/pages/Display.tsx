import { SettingsSidebar } from "../components.js";
import { SettingsHeader } from "../settings/SettingsHeader.js";
import { DisplaySettings } from "../settings/DisplaySettings.js";
import "../styles/settings.css";

export default function Display() {
  return <div className="settings-app display-app">
    <SettingsSidebar page="display" />
    <main className="settings-main display-main" id="content">
      <SettingsHeader page="display" />
      <div className="display-page"><DisplaySettings /></div>
    </main>
  </div>;
}
