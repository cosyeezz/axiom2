import { useEffect } from "react";
import { command, useConnectionState } from "../transport.js";
import type { Scope } from "../../shared/protocol.js";

/** A visible, focused conversation is continuously being viewed, even while reading without input. */
export function useSessionAttention(scope: Scope | null) {
  const connection = useConnectionState();
  useEffect(() => {
    if (!scope?.sessionId || !connection.connected) return;
    let active: boolean | undefined;
    const send = (next: boolean) => {
      if (active === next) return;
      active = next;
      void command("session.view", { active: next }, scope).catch(() => {
        // Presence is safe to re-establish on focus/interaction/reconnection, unlike agent commands.
        if (active === next) active = undefined;
      });
    };
    const sync = () => send(document.visibilityState === "visible" && document.hasFocus());
    const leave = () => send(false);
    sync();
    window.addEventListener("focus", sync);
    window.addEventListener("blur", leave);
    window.addEventListener("pageshow", sync);
    window.addEventListener("pagehide", leave);
    document.addEventListener("visibilitychange", sync);
    // Interactions renew the foreground lease after a transient failure. While it is held,
    // every click/input/read is covered; departure always starts a fresh full cooldown.
    document.addEventListener("pointerdown", sync);
    document.addEventListener("input", sync);
    document.addEventListener("keydown", sync);
    return () => {
      window.removeEventListener("focus", sync);
      window.removeEventListener("blur", leave);
      window.removeEventListener("pageshow", sync);
      window.removeEventListener("pagehide", leave);
      document.removeEventListener("visibilitychange", sync);
      document.removeEventListener("pointerdown", sync);
      document.removeEventListener("input", sync);
      document.removeEventListener("keydown", sync);
      leave();
    };
  }, [scope?.workspaceId, scope?.sessionId, connection]);
}
