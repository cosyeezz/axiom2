import { useContext, useState } from "react";
import type { Scope } from "../../shared/protocol.js";
import type { SkillReference } from "../../shared/skills.js";
import { command, useConnectionState } from "../transport.js";
import { FilePreviewContext } from "./FileLink.js";
import { Icon } from "../Icon.js";
import "../styles/skill-cards.css";

// Shared Lucide book-open-check (ISC), S01 selected in the design preview.
export function SkillIcon() { return <Icon name="book-open-check" className="skill-icon" />; }
export function SkillFileActions({ skill, scope, disabled = false, onPreview }: {
  skill: SkillReference; scope: Scope; disabled?: boolean; onPreview?: () => void;
}) {
  const connected = useConnectionState().connected, preview = useContext(FilePreviewContext);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const reveal = async () => {
    if (busy) return;
    setBusy(true); setError("");
    try { await command("capabilities.skill.reveal", { id: skill.id }, scope); }
    catch (cause) { setError((cause as Error).message); }
    finally { setBusy(false); }
  };
  return <><span className="skill-file-actions">
    <button type="button" className="icon-btn" disabled={disabled || busy || !connected || !preview} aria-label={`编辑技能文件：${skill.name}`} data-tooltip="预览并编辑技能文件"
      onClick={event => { onPreview?.(); preview?.({ skillId: skill.id, owner: { scope }, trigger: event.currentTarget, edit: true }); }}><Icon name="square-pen" /></button>
    <button type="button" className="icon-btn" disabled={disabled || busy || !connected} aria-label={`打开技能位置：${skill.name}`} data-tooltip="打开文件位置" onClick={() => void reveal()}><Icon name="folder" /></button>
  </span>{error && <span className="skill-file-error" role="alert">{error}</span>}</>;
}
export function SkillCards({ skills, scope, onRemove, compact = !!onRemove }: {
  skills?: SkillReference[]; scope: Scope; onRemove?: (id: string) => void; compact?: boolean;
}) {
  const preview = useContext(FilePreviewContext);
  if (!skills?.length) return null;
  return <div className={`skill-cards${compact ? " is-compact" : ""}`} aria-label={compact ? "本次使用的技能" : "消息引用的技能"}>
    {skills.map(skill => compact ? <span className="skill-chip" key={skill.id}>
      <button type="button" className="skill-chip-label" aria-label={`编辑技能文件：${skill.name}`} data-tooltip={`${skill.name} · ${skill.description || "预览并编辑技能"}`} disabled={!preview}
        onClick={event => preview?.({ skillId: skill.id, owner: { scope }, trigger: event.currentTarget, edit: true })}><SkillIcon /><span>{skill.name}</span></button>
      {onRemove && <button type="button" className="icon-btn" aria-label={`移除技能：${skill.name}`} data-tooltip="移除此技能引用" onClick={() => onRemove(skill.id)}><Icon name="x" /></button>}
    </span> : <div className="skill-card" key={skill.id}>
      <SkillIcon /><span className="skill-card-copy"><strong title={skill.name}>{skill.name}</strong><span title={skill.description}>{skill.description || "暂无描述"}</span></span>
      <SkillFileActions skill={skill} scope={scope} />
    </div>)}
  </div>;
}
