import { Component, createContext, type ReactNode } from "react";
import { diagramCell, diagramLabelRuns, diagramStrokePath, type AsciiDiagram } from "../../shared/ascii-diagram.js";

// A streaming reply stays literal until complete; compact summaries never draw.
export const DiagramRenderingContext = createContext(true);
class DiagramBoundary extends Component<{ source: string; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    return this.state.failed ? <>
      <div className="code-notice" role="status">暂时无法美化，已保留原文。</div>
      <pre><code>{this.props.source}</code></pre>
    </> : this.props.children;
  }
}
export function AsciiDiagramPreview({ diagram, source }: { diagram: AsciiDiagram; source: string }) {
  const { width: w, height: h, padding: p } = diagramCell;
  const width = diagram.columns * w + p * 2, height = diagram.rows * h + p * 2;
  return <DiagramBoundary key={source} source={source}><div className="ascii-diagram-preview" tabIndex={0} aria-label="字符图，可横向滚动">
    <svg className="ascii-diagram-svg" xmlns="http://www.w3.org/2000/svg" width={width} height={height} style={{ width, height, stroke: "none" }} viewBox={`0 0 ${width} ${height}`} role="img" aria-label="字符图美化视图">
      <g className="ascii-diagram-lines" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        {diagram.strokes.map((stroke, i) => <path key={i} d={diagramStrokePath(stroke)} />)}
      </g>
      <g className="ascii-diagram-labels" fill="currentColor" fontSize="14" fontWeight="400" dominantBaseline="central">
        {/* Keep natural CJK words together; anchor ASCII and script transitions
            independently so mixed labels cannot accumulate column drift. */}
        {diagram.labels.map((label, i) => <text key={i} x={p + label.x * w} y={p + (label.y + .5) * h}>
          {diagramLabelRuns(label).map((run, j) => <tspan key={j} x={p + run.center * w} textAnchor="middle">{run.text}</tspan>)}
        </text>)}
      </g>
    </svg>
  </div></DiagramBoundary>;
}
