import { useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { VirtualTimeline, type TimelineRow } from "../../src/client/chat/VirtualTimeline.js";

let renders = 0;
function Fixture() {
  const scroller = useRef<HTMLElement>(null), following = useRef(false);
  const [mode, setMode] = useState<"empty" | "long">("empty");
  (window as any).historyWindow = { renders: () => renders, setMode };
  const rows: TimelineRow[] = mode === "empty"
    ? Array.from({ length: 51 }, (_, i) => ({ key: `empty-${i}`, estimate: 300, render: () => { renders++; return i === 50 ? <div style={{ height: 120 }}>Only visible message</div> : null; } }))
    : Array.from({ length: 200 }, (_, i) => ({ key: `long-${i}`, estimate: 80, render: () => { renders++; return <div style={{ height: 80 }}>Message {i} — selection and scrolling regression</div>; } }));
  return <><section className="thread" ref={scroller} style={{ height: 400, overflow: "auto", overflowAnchor: "none", width: 700 }}>
    <VirtualTimeline rows={rows} scroller={scroller} following={following} />
  </section><textarea id="prompt" aria-label="Isolated composer" /></>;
}
createRoot(document.getElementById("root")!).render(<Fixture />);
