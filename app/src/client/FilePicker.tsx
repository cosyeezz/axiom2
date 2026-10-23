import { useEffect, useRef, useState, type ButtonHTMLAttributes, type InputHTMLAttributes } from "react";
import type { PickedAttachment } from "../shared/protocol.js";
import { PathActions, isLocalPath } from "./LocalPath.js";
import { Icon } from "./Icon.js";
import { openFileDialog, type OpenFileDialogRequest } from "./OpenFileDialog.js";
import "./styles/file-picker.css";

/** Shared trigger for native and remote file browsers. Owners may keep their own draft lifecycle. */
export function FilePickerButton({ picking = false, label = "打开文件或文件夹", busyLabel = "正在选择…", icon = "folder-open", iconOnly = false, onCancel, disabled, className = "btn", ...props }: Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> & {
  picking?: boolean; label?: string; busyLabel?: string; icon?: string; iconOnly?: boolean; onCancel?: () => void;
}) {
  const text = picking ? onCancel ? "取消选择" : busyLabel : label;
  return <button {...props} type="button" className={className} aria-label={props["aria-label"] ?? text}
    aria-haspopup="dialog" aria-busy={picking} disabled={disabled || picking && !onCancel}
    onClick={picking && onCancel ? onCancel : props.onClick}>
    <Icon name={picking && onCancel ? "close" : icon} />{!iconOnly && text}
  </button>;
}

/** Cancels on unmount and ignores late results; a cancelled picker never changes the input. */
export function useFilePicker({ onPick, onError, onPickingChange }: {
  onPick: (items: PickedAttachment[]) => void; onError: (message: string) => void; onPickingChange?: (picking: boolean) => void;
}) {
  const [picking, setPicking] = useState(false);
  const request = useRef<AbortController | null>(null);
  const callbacks = useRef({ onPick, onError, onPickingChange }); callbacks.current = { onPick, onError, onPickingChange };
  useEffect(() => () => { const active = request.current; request.current = null; active?.abort(); if (active) callbacks.current.onPickingChange?.(false); }, []);
  async function pick(options: OpenFileDialogRequest) {
    if (request.current) return;
    const controller = new AbortController(); request.current = controller;
    setPicking(true); callbacks.current.onPickingChange?.(true); callbacks.current.onError("");
    try {
      const items = await openFileDialog(options, controller.signal);
      if (!controller.signal.aborted && items.length) callbacks.current.onPick(items);
    } catch (error) { if (!controller.signal.aborted) callbacks.current.onError(error instanceof Error ? error.message : String(error)); }
    finally { if (request.current === controller) { request.current = null; setPicking(false); callbacks.current.onPickingChange?.(false); } }
  }
  return { picking, pick, cancel: () => request.current?.abort() };
}

export function PathInput({ value, onChange, request, onError, onPickingChange, onPick, buttonLabel, disabled, readOnly, className = "input", ...input }: Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "onError" | "type"> & {
  value: string; onChange: (value: string) => void; request: OpenFileDialogRequest;
  onError: (message: string) => void; onPickingChange?: (picking: boolean) => void;
  onPick?: (item: PickedAttachment) => void; buttonLabel?: string;
}) {
  const picker = useFilePicker({ onError, onPickingChange, onPick: ([item]) => { onChange(item.path); onPick?.(item); } });
  const label = buttonLabel ?? (request.kind === "folder" ? "打开文件夹" : request.kind === "file" ? "打开文件" : "打开文件或文件夹");
  return <div className="path-input">
    <input {...input} type="text" className={className} value={value} autoComplete="off" spellCheck={false}
      disabled={disabled} readOnly={readOnly || picker.picking} onChange={event => onChange(event.target.value)} />
    {isLocalPath(value) && <PathActions path={value} onError={onError} />}
    <FilePickerButton label={label} picking={picker.picking} disabled={disabled || readOnly} onClick={() => void picker.pick(request)} />
  </div>;
}
