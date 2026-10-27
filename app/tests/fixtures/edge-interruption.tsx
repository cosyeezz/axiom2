import { useRef } from "react";
import { createRoot } from "react-dom/client";
import { VirtualTimeline, type TimelineNavigation } from "../../src/client/chat/VirtualTimeline.js";
import { useThreadScrollIntent } from "../../src/client/chat/useThreadScrollIntent.js";

function Fixture() {
  const scroller = useRef<HTMLElement>(null), following = useRef(false), position = useRef(0);
  const navigation = useRef<TimelineNavigation>(null);
  useThreadScrollIntent(scroller, following, position);
  const rows = Array.from({ length: 200 }, (_, i) => ({ key: `row-${i}`, estimate: 80,
    render: () => <div className="body" style={{ height: 80 }}>Content {i}</div> }));
  const growBelowViewport = () => {
    const node = scroller.current!, bounds = node.getBoundingClientRect();
    const body = [...node.querySelectorAll<HTMLElement>(".body")].find(row => row.getBoundingClientRect().top >= bounds.bottom)!;
    body.style.height = "140px";
  };
  (window as any).edgeProbe = {
    snapshot: () => ({ top: scroller.current!.scrollTop, active: navigation.current!.edgeActive() }),
    growBelowViewport,
    interruptAndGrow() {
      const node = scroller.current!, before = node.scrollTop;
      // Call in the rAF immediately after an edge animation writes its position.
      // Freeze, cancel and resize in that turn: a real RO then precedes the next
      // native scroll event. The synthetic wheel does not claim default scrolling.
      node.scrollTo({ top: before, behavior: "instant" });
      node.dispatchEvent(new WheelEvent("wheel", { deltaY: -80, bubbles: true }));
      growBelowViewport();
      return before;
    },
  };
  return <>
    <button onClick={() => {
      following.current = true;
      navigation.current!.edge("bottom", "smooth");
    }}>Bottom</button>
    <section className="thread" ref={scroller} tabIndex={0} onWheel={() => navigation.current?.cancel()}
      style={{ height: 400, width: 700, overflow: "auto", overflowAnchor: "none" }}>
      <VirtualTimeline rows={rows} scroller={scroller} following={following} scrollPosition={position} navigation={navigation} />
    </section>
  </>;
}
createRoot(document.getElementById("root")!).render(<Fixture />);
