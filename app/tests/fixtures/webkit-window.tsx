import { useLayoutEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import { VirtualTimeline, timelineKeyEdge, type TimelineNavigation } from "../../src/client/chat/VirtualTimeline.js";

// Real rows (Markdown, disclosures) have layout-effect cleanups that read
// geometry. React runs them while deleting the old window, before inserting
// the new one, which forces a WebKit layout of the transiently short content.
function Body({ height, label, delivery }: { height: number; label: string; delivery?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => () => { void ref.current?.closest(".thread")?.scrollHeight; }, []);
  // A fractional marker inset makes the reveal target fractional; WebKit snaps
  // scrollTop to whole pixels, so the reveal must settle within 1px.
  return <div ref={ref} className="body" style={{ height }}>{label}
    {delivery && <div data-delivery-start={label} style={{ marginTop: 13.7 }}>Delivery {label}</div>}</div>;
}
// Rows are estimated much shorter than their real bodies, like long history
// replies. Moving the virtual window replaces rows and spacers in one commit.
function Fixture() {
  const scroller = useRef<HTMLElement>(null), following = useRef(false), position = useRef(0);
  const navigation = useRef<TimelineNavigation>(null);
  const rows = Array.from({ length: 40 }, (_, i) => ({ key: `row-${i}`, estimate: 80, delivery: i % 8 === 3,
    render: () => <Body height={360 + (i % 5) * 40} label={`Content ${i}`} delivery={i % 8 === 3} /> }));
  (window as any).windowProbe = {
    edge: (target: "top" | "bottom") => navigation.current!.edge(target, "instant"),
    step: (direction: "up" | "down") => navigation.current!.step(direction),
    // A programmatic jump (find, selection autoscroll) after a finished reveal.
    jump: () => new Promise<number[]>(resolve => {
      const node = scroller.current!, seen: number[] = [];
      node.scrollTop = node.scrollHeight;
      const frame = () => { seen.push(node.scrollTop); if (seen.length < 6) requestAnimationFrame(frame); else resolve(seen); };
      requestAnimationFrame(frame);
    }),
    snapshot: () => { const node = scroller.current!; return { top: node.scrollTop, max: node.scrollHeight - node.clientHeight, active: navigation.current!.edgeActive() }; },
  };
  // ?native=1 keeps the browser's own Home/End animation (the old behavior).
  const native = new URLSearchParams(location.search).has("native");
  return <section className="thread" ref={scroller} tabIndex={0}
    onKeyDown={event => {
      const edge = native ? null : timelineKeyEdge(event);
      if (edge) { event.preventDefault(); navigation.current!.edge(edge, "smooth"); }
    }}
    style={{ height: 600, width: 700, overflow: "auto", overflowAnchor: "none" }}>
    <VirtualTimeline rows={rows} scroller={scroller} following={following} scrollPosition={position} navigation={navigation} />
  </section>;
}
createRoot(document.getElementById("root")!).render(<Fixture />);
