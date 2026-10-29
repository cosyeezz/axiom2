import { useRef, useState } from "react";
import { isEnvironmentInventory } from "../../shared/environment-inventory.js";
import DesktopArchiveCleanup from "./DesktopArchiveCleanup.js";
import DesktopServiceRemoval from "./DesktopServiceRemoval.js";
import DesktopPiRemoval from "./DesktopPiRemoval.js";
import DesktopToolCleanup from "./DesktopToolCleanup.js";
import { desktopInvoke } from "./desktop-bridge.js";
import { ComponentAction, ComponentCard } from "../maintenance/ComponentCard.js";
import "../styles/environment-inventory.css";

export default function DesktopEnvironment({ environment, serviceState }: { environment?: { tailscale: boolean; platform: string } | null; serviceState?: string }) {
  const [opening, setOpening] = useState(false), [notice, setNotice] = useState("");
  const verification = useRef<Promise<boolean> | null>(null);
  // Keep the post-operation inventory check internal. Its paths are never deletion authority.
  async function refresh(): Promise<boolean> {
    if (verification.current) return verification.current;
    const work = (async () => {
      try {
        const value = await desktopInvoke<unknown>("axiom_environment", { root: null });
        return isEnvironmentInventory(value) && value.scope !== "selected";
      } catch { return false; }
    })();
    verification.current = work;
    try { return await work; } finally { if (verification.current === work) verification.current = null; }
  }
  async function uninstallSettings() {
    if (opening) return;
    setOpening(true); setNotice("");
    try {
      await desktopInvoke("axiom_setup", { action: "uninstall-settings" });
      setNotice("已打开系统应用列表，请选择 Tailscale 完成卸载。");
    } catch (cause) { setNotice(cause instanceof Error ? cause.message : String(cause)); }
    finally { setOpening(false); }
  }
  return <section className="environment-inventory environment-components" aria-label="已安装组件">
    <p className="connect-update-detail">选择需要卸载的组件。项目、会话和个人设置默认保留。</p>
    <DesktopPiRemoval onRescan={refresh} />
    {environment?.tailscale && <ComponentCard className="environment-component" label="Tailscale" regionLabel="Tailscale 卸载" kind="environment" busy={opening}
      description={environment.platform === "windows" ? "在系统应用列表中卸载" : "请使用系统或原安装方式卸载。"}
      actions={<ComponentAction icon="external-link" label="打开系统卸载列表" disabled={opening || environment.platform !== "windows"} disabledReason={opening ? "正在打开系统应用列表。" : "当前平台请使用系统或原安装方式卸载。"} onClick={() => void uninstallSettings()} />}>
      {notice && <p className="connect-update-detail" role="status">{notice}</p>}
    </ComponentCard>}
    <DesktopToolCleanup onRescan={refresh} />
    <DesktopServiceRemoval onRescan={refresh} installed={serviceState ? ['running', 'starting', 'stopping', 'stopped'].includes(serviceState) : false} />
    <DesktopArchiveCleanup onRescan={refresh} />
  </section>;
}
