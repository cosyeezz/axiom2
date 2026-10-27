import { useRef } from "react";
import { createRoot } from "react-dom/client";
import { VirtualTimeline, type TimelineNavigation } from "../../src/client/chat/VirtualTimeline.js";

const estimate = Number(new URLSearchParams(location.search).get("estimate") ?? 80);
const actual = Number(new URLSearchParams(location.search).get("actual") ?? 80);
function Fixture() {
  const scroller = useRef<HTMLElement>(null), following = useRef(false), navigation = useRef<TimelineNavigation>(null);
  const rows = Array.from({ length: 2000 }, (_, i) => ({ key: `row-${i}`, estimate,
    render: () => <div className="body" style={{ height: actual, background: "#8c8" }}>Body {i}</div> }));
  (window as any).timelineProbe = {
    edge(target: "top" | "bottom", behavior: "smooth" | "instant") { following.current = target === "bottom"; navigation.current!.edge(target, behavior); },
    snapshot() {
    const node = scroller.current!, bounds = node.getBoundingClientRect();
    const overlap = (element: Element) => {
      const rect = element.getBoundingClientRect();
      return Math.max(0, Math.min(rect.bottom, bounds.bottom) - Math.max(rect.top, bounds.top));
    };
    const mounted = [...node.querySelectorAll<HTMLElement>("[data-timeline-key]")];
    return { top: node.scrollTop, edgeActive: navigation.current!.edgeActive(), windowTop: node.querySelector(".virtual-timeline")?.getAttribute("data-window-top"),
      first: mounted[0] && { key: mounted[0].dataset.timelineKey, top: mounted[0].getBoundingClientRect().top - bounds.top },
      last: mounted.at(-1) && { key: mounted.at(-1)!.dataset.timelineKey, top: mounted.at(-1)!.getBoundingClientRect().top - bounds.top },
      mounted: mounted.length,
      spacer: [...node.querySelectorAll(".timeline-spacer")].reduce((sum, row) => sum + overlap(row), 0) / node.clientHeight,
      body: [...node.querySelectorAll(".body")].reduce((sum, row) => sum + overlap(row), 0) / node.clientHeight };
  } };
  return <section className="thread" ref={scroller} tabIndex={0}
    style={{ height: 600, width: 800, overflow: "auto", overflowAnchor: "none" }}>
    <VirtualTimeline rows={rows} scroller={scroller} following={following} navigation={navigation} />
  </section>;
}
createRoot(document.getElementById("root")!).render(<Fixture />);
