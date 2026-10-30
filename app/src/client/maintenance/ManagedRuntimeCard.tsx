import { ComponentAction, ComponentCard } from "./ComponentCard.js";

/** Sibling environment facts, not independent Node/npm installation capabilities. */
export function ManagedRuntimeCard({ owner, nodeVersion, npmVersion, disabled, onCheck }: {
  owner: string; nodeVersion?: string; npmVersion?: string; disabled?: boolean; onCheck: () => void;
}) {
  const responsibility = `由 ${owner} 安装器在原安装位置整体维护；安装、重装与卸载请使用 ${owner} 卡片的对应操作，不单独修改系统环境。`;
  return <>
    <ComponentCard kind="environment" label="Node.js" regionLabel={`${owner}专属 Node.js 环境`} version={nodeVersion || "版本待检查"}
      description={`${owner} 专属 JavaScript 运行时，与程序一同维护。`}
      details={<p className="maintenance-note">{responsibility}</p>}
      actions={<ComponentAction icon="refresh-cw" label={`检查${owner}专属环境`} disabled={disabled} onClick={onCheck} />} />
    <ComponentCard kind="environment" label="npm" regionLabel={`${owner} npm 环境`} version={npmVersion || "版本待检查"}
      description="随专属运行时分发的包管理器；npm 运行依赖 Node.js，并非 Node.js 的依赖。"
      details={<p className="maintenance-note">{responsibility}</p>} />
  </>;
}
