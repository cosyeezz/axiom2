import { useEffect, useRef, useState } from "react";
import type { Workspace } from "../../shared/protocol.js";
import { Icon } from "../components.js";
import { DeleteButton } from "../DeleteButton.js";
import { ConfirmDialog } from "../ConfirmDialog.js";
import { command } from "../transport.js";

export interface WorkspacePickerProps {
  workspaces: Workspace[];
  workspace?: Workspace;
  select: (workspace: Workspace) => void;
  picking: boolean;
  choose: () => void;
  onError: (message: string) => void;
}

export function WorkspacePicker({ workspaces, workspace, select, picking, choose, onError }: WorkspacePickerProps) {
  const details = useRef<HTMLDetailsElement>(null);
  const summary = useRef<HTMLElement>(null);
  const navigation = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const cancelSelection = () => {
    clearTimeout(navigation.current);
    navigation.current = undefined;
  };
  useEffect(() => {
    const dismiss = (event: MouseEvent) => {
      const picker = details.current;
      const target = event.target;
      if (!picker?.open || !(target instanceof Node) || picker.contains(target)) return;
      // Confirmation dialogs render in a body portal and own their dismissal.
      if (target instanceof Element && target.closest("dialog[open]")) return;
      cancelSelection();
      picker.open = false;
    };
    document.addEventListener("click", dismiss, true);
    return () => {
      document.removeEventListener("click", dismiss, true);
      cancelSelection();
    };
  }, []);
  const close = () => {
    cancelSelection();
    if (details.current) details.current.open = false;
  };
  const navigate = (w: Workspace, keyboard: boolean) => {
    cancelSelection();
    const apply = () => {
      close();
      select(w);
    };
    // Defer pointer navigation as well as closing: a double click only renames,
    // including on mobile where selecting would hide the whole sidebar.
    if (keyboard) apply();
    else navigation.current = setTimeout(apply, 300);
  };
  return (
    <details
      ref={details}
      className="workspace-picker"
      id="workspace-picker"
      onToggle={() => { if (!details.current?.open) cancelSelection(); }}
      onKeyDown={(e) => {
        if (e.key === "Escape" && details.current?.open && !e.defaultPrevented && !(e.target instanceof HTMLInputElement)) {
          e.preventDefault();
          close();
          summary.current?.focus();
        }
      }}
    >
      <summary ref={summary} data-view-navigation aria-label={`切换工作空间：${workspace?.name || "尚未选择"}`}>
        <Icon name="workspace" />
        <span className="workspace-copy"><strong>{workspace?.name || "选择工作空间"}</strong></span>
        <Icon name="chevron" />
      </summary>
      <div className="workspace-menu">
        <div className="workspace-list" aria-label="工作空间列表">
          {[...workspaces].sort((a, b) => Number(b.pinned) - Number(a.pinned)).map((w) => (
            <WorkspaceRow key={w.id} workspace={w} selected={workspace?.id === w.id}
              navigate={navigate} cancelSelection={cancelSelection} onError={onError} />
          ))}
        </div>
        <button type="button" id="add-workspace" data-view-navigation disabled={picking} aria-busy={picking}
          onClick={() => { close(); choose(); }}>
          <Icon name="workspace-open" />{picking ? "正在选择文件夹…" : "打开文件夹…"}
        </button>
      </div>
    </details>
  );
}

function WorkspaceRow({ workspace: w, selected, navigate, cancelSelection, onError }: {
  workspace: Workspace;
  selected: boolean;
  navigate: (w: Workspace, keyboard: boolean) => void;
  cancelSelection: () => void;
  onError: (message: string) => void;
}) {
  const [deleting, setDeleting] = useState<Workspace | null>(null);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(w.name);
  const [busy, setBusy] = useState(false);
  const editingRef = useRef(false);
  const busyRef = useRef(false);
  const composing = useRef(false);
  const blurredDuringComposition = useRef(false);
  const button = useRef<HTMLButtonElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  const run = async (op: string, params: Record<string, unknown>) => {
    cancelSelection();
    if (busyRef.current) return false;
    busyRef.current = true;
    setBusy(true);
    try {
      await command(op, params, { workspaceId: w.id });
      return true;
    } catch (error) {
      onError(error instanceof Error ? error.message : String(error));
      return false;
    } finally {
      busyRef.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  const rename = () => {
    cancelSelection();
    if (busyRef.current || editingRef.current) return;
    setName(w.name);
    composing.current = false;
    blurredDuringComposition.current = false;
    editingRef.current = true;
    setEditing(true);
  };
  const finish = (restoreFocus: boolean) => {
    editingRef.current = false;
    setEditing(false);
    if (restoreFocus) requestAnimationFrame(() => button.current?.focus());
  };
  const save = async (restoreFocus: boolean) => {
    if (!editingRef.current || busyRef.current) return;
    if (composing.current) {
      blurredDuringComposition.current = true;
      return;
    }
    const nextName = (input.current?.value ?? name).trim();
    if (!nextName || nextName === w.name) {
      finish(restoreFocus);
      return;
    }
    const saved = await run("workspace.rename", { name: nextName });
    if (!mounted.current) return;
    // A delayed response must not steal focus from another row or the composer.
    const stillFocused = document.activeElement === input.current;
    if (saved) finish(restoreFocus && stillFocused);
    // Failed saves keep the draft for explicit correction or retry.
  };
  const remove = () => {
    cancelSelection();
    if (busyRef.current) return;
    setDeleting(w);
  };
  const content = (
    <>
      <Icon name="workspace" />
      <span className="workspace-copy">
      {editing ? (
        <input ref={input} className="workspace-name-input" aria-label="工作空间名称"
          aria-busy={busy} readOnly={busy} autoFocus maxLength={120} value={name}
          onFocus={(e) => e.currentTarget.select()}
          onChange={(e) => setName(e.target.value)}
          onCompositionStart={() => { composing.current = true; }}
          onCompositionEnd={() => {
            composing.current = false;
            if (blurredDuringComposition.current) {
              blurredDuringComposition.current = false;
              void save(false);
            }
          }}
          onBlur={() => { void save(false); }}
          onKeyDown={(e) => {
            if (composing.current || e.nativeEvent.isComposing || e.keyCode === 229) return;
            if (e.key === "Enter") {
              e.preventDefault();
              void save(true);
            } else if (e.key === "Escape") {
              e.preventDefault();
              e.stopPropagation();
              if (!busyRef.current) finish(true);
            }
          }} />
      ) : <strong>{w.name}</strong>}
      </span>
    </>
  );
  return (
    <div className="workspace-row" data-editing={editing} aria-busy={busy}>
      {deleting && <ConfirmDialog title="删除工作空间" subject={deleting.name}
        description="仅从列表移出，保留项目文件和会话历史。正在运行的 Agent 或任务需先停止。再次打开同一目录可恢复。"
        confirmLabel="删除工作空间" danger onClose={() => setDeleting(null)}
        onConfirm={() => command("workspace.delete", { confirmed: true }, { workspaceId: deleting.id })} />}
      {editing ? <div className="workspace-option" aria-current={selected}>{content}</div> : (
        <button ref={button} type="button" className="workspace-option" data-view-navigation aria-current={selected}
          aria-label={w.name} data-tooltip={`${w.name} · ${w.path} · 双击重命名（F2），Delete 删除`}
          onPointerDown={(e) => { if (e.detail > 1) cancelSelection(); }}
          onClick={(e) => { if (e.detail < 2) navigate(w, e.detail === 0); }}
          onDoubleClick={rename}
          onKeyDown={(e) => {
            if (e.key === "F2") { e.preventDefault(); rename(); }
            if (e.key === "Delete") { e.preventDefault(); remove(); }
          }}>{content}</button>
      )}
      <div className="workspace-actions">
        <button type="button" className="icon-btn workspace-pin" disabled={busy}
          aria-label={`${w.pinned ? "取消置顶工作空间" : "置顶工作空间"}：${w.name}`}
          data-tooltip={w.pinned ? "取消置顶" : "置顶工作空间"} aria-pressed={w.pinned}
          onClick={() => void run("workspace.pin", { pinned: !w.pinned })}>
          <svg aria-hidden="true" viewBox="0 0 24 24">
            <path d={w.pinned ? "M5 5h14M12 10v10m-5-5 5 5 5-5" : "M5 5h14M12 20V10m-5 5 5-5 5 5"} />
          </svg>
        </button>
        <DeleteButton className="icon-btn workspace-delete" disabled={busy}
          label={`删除工作空间：${w.name}`} title="删除工作空间" onConfirm={remove}
          onPendingChange={(pending) => { if (pending) cancelSelection(); }}
          onDelete={() => void run("workspace.delete", { confirmed: true })} />
      </div>
    </div>
  );
}
