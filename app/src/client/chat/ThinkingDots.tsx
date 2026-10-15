import "../styles/thinking.css";

export function ThinkingDots() {
  return <span className="thinking-indicator" role="img" aria-label="正在思考"><span aria-hidden="true">thinking </span><span className="thinking-dots" aria-hidden="true"><span>.</span><span>.</span><span>.</span></span></span>;
}
