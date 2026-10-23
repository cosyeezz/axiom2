import { useLayoutEffect, useRef, type TextareaHTMLAttributes } from "react";
import { JsonPaths } from "./LocalPath.js";
import { FilePickerButton, useFilePicker } from "./FilePicker.js";
import { jsonPathRange } from "./json-path.js";

/** Keeps arbitrary config fields intact while allowing every JSON path value to use the same picker. */
export function JsonPathInput({ value, onChange, onError, onPickingChange, disabled, ...props }: Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "value" | "onChange" | "onError"> & {
  value: string; onChange: (value: string) => void; onError: (message: string) => void; onPickingChange?: (picking: boolean) => void;
}) {
  const input = useRef<HTMLTextAreaElement>(null);
  const selection = useRef<{ text: string; start: number; end: number } | null>(null);
  const restore = useRef<{ text: string; start: number; end: number } | null>(null);
  useLayoutEffect(() => {
    const target = restore.current;
    if (!target || target.text !== value) return;
    restore.current = null;
    input.current?.focus(); input.current?.setSelectionRange(target.start, target.end);
  });
  const picker = useFilePicker({ onError, onPickingChange, onPick: ([item]) => {
    const selected = selection.current;
    if (!selected || selected.text !== value) { onError("配置已变化，请重新选择要填写的路径值。"); return; }
    const path = JSON.stringify(item.path);
    const next = value.slice(0, selected.start) + path + value.slice(selected.end);
    restore.current = { text: next, start: selected.start + 1, end: selected.start + path.length - 1 };
    onChange(next);
  } });
  function pick(kind: "file" | "folder") {
    const node = input.current;
    const range = node && jsonPathRange(value, node.selectionStart, node.selectionEnd);
    if (!range) { onError('请先将光标放到 JSON 中的路径字符串内，例如 "command": "" 或 "args": [""]。'); node?.focus(); return; }
    selection.current = { text: value, ...range };
    void picker.pick({ purpose: "path", kind, multiple: false });
  }
  return <>
    <textarea {...props} ref={input} value={value} disabled={disabled} readOnly={props.readOnly || picker.picking} spellCheck={false} onChange={event => onChange(event.target.value)} />
    <JsonPaths text={value} />
    <div className="json-path-actions">
      <FilePickerButton label="选择文件" picking={picker.picking} disabled={disabled || props.readOnly} onClick={() => pick("file")} />
      <FilePickerButton label="选择目录" picking={picker.picking} disabled={disabled || props.readOnly} onClick={() => pick("folder")} />
      <p className="field-help">将光标放到要填写的路径字符串内，选择后替换该值。适用于命令、参数及环境变量中的路径。</p>
    </div>
  </>;
}
