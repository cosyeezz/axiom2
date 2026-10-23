import { useEffect, useState, type ReactNode } from "react";

/** Defer hidden UI work until first use, then retain its drafts and local state. */
export function MountOnVisit({ active, children }: { active: boolean; children: ReactNode }) {
  const [visited, setVisited] = useState(active);
  useEffect(() => { if (active) setVisited(true); }, [active]);
  return active || visited ? children : null;
}
