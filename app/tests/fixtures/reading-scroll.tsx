import { useRef } from "react";
import { createRoot } from "react-dom/client";
import { VirtualTimeline } from "../../src/client/chat/VirtualTimeline.js";

function Fixture() {
  const scroller = useRef<HTMLElement>(null), following = useRef(false);
  const heights = useRef(new Map<number, number>()), defaultHeight = useRef(80);
  (window as any).readingScroll = {
    snapshot() {
      const node = scroller.current!, bounds = node.getBoundingClientRect();
      const rows = [...node.querySelectorAll<HTMLElement>("[data-timeline-key]")];
      const row = rows.find(row => row.getBoundingClientRect().bottom > bounds.top)!;
      return { key: row.dataset.timelineKey!, offset: row.getBoundingClientRect().top - bounds.top,
        scroll: node.scrollTop, mounted: rows.length,
        visibleSpacer: [...node.querySelectorAll(".timeline-spacer")].some(spacer => {
          const rect = spacer.getBoundingClientRect();
          return Math.min(rect.bottom, bounds.bottom) - Math.max(rect.top, bounds.top) > 1;
        }) };
    },
    vary() { defaultHeight.current = 160; },
    resize(index: number, height: number) {
      heights.current.set(index, height);
      const body = document.querySelector<HTMLElement>(`[data-timeline-key="row-${index}"] > div`);
      if (body) body.style.height = `${height}px`;
    },
  };
  const rows = Array.from({ length: 200 }, (_, index) => ({ key: `row-${index}`, estimate: 80,
    render: () => <div style={{ height: heights.current.get(index) ?? defaultHeight.current }}>Reading row {index}</div> }));
  return <section className="thread" ref={scroller} tabIndex={0}
    style={{ height: 400, width: 700, overflow: "auto", overflowAnchor: "none" }}>
    <VirtualTimeline rows={rows} scroller={scroller} following={following} />
  </section>;
}
createRoot(document.getElementById("root")!).render(<Fixture />);
