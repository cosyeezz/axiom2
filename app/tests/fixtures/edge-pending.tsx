import { useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { VirtualTimeline, type TimelineNavigation } from "../../src/client/chat/VirtualTimeline.js";

function Fixture() {
  const scroller = useRef<HTMLElement>(null), following = useRef(false), navigation = useRef<TimelineNavigation>(null);
  const [pending, setPending] = useState(true);
  const rows = Array.from({ length: 500 }, (_, i) => ({ key: `row-${i}`, estimate: 80,
    isPending: i === 499 ? () => pending : undefined,
    render: () => <div style={{ height: i === 499 ? pending ? 56 : 6000 : 80, background: "#8c8" }}>Body {i}</div> }));
  (window as any).pendingEdge = {
    start() { following.current = true; navigation.current!.edge("bottom", "smooth"); },
    resolve() { setPending(false); },
    snapshot() { const t = scroller.current!; return { active: navigation.current!.edgeActive(), top: t.scrollTop,
      gap: t.scrollHeight - t.clientHeight - t.scrollTop, mounted: t.querySelectorAll("[data-timeline-key]").length }; },
  };
  return <section ref={scroller} className="thread" style={{ height: 600, width: 694, overflow: "auto", overflowAnchor: "none" }}>
    <VirtualTimeline rows={rows} scroller={scroller} following={following} navigation={navigation} />
  </section>;
}
createRoot(document.getElementById("root")!).render(<Fixture />);
