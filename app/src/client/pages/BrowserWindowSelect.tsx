import { Select } from "../Select.js";
import type { OpenCliSettings } from "../../shared/builtin-tools.js";

type WindowMode = OpenCliSettings["window"];
const options: { value: WindowMode; label: string }[] = [
  { value: "foreground", label: "前台显示" },
  { value: "background", label: "后台运行" },
];

export function BrowserWindowSelect({ value, disabled, onChange }: {
  value: WindowMode;
  disabled: boolean;
  onChange: (value: WindowMode) => void;
}) {
  return <Select id="opencli-window" label="浏览器窗口" descriptionId="opencli-window-help"
    value={value} disabled={disabled} options={options} onChange={value => onChange(value as WindowMode)} />;
}
