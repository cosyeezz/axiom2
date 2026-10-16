import { RunningDots } from "./RunningDots.js";
import "../styles/thinking.css";

export function ThinkingDots({ label = "thinking" }: { label?: string }) {
  return <span className="thinking-indicator" role="img" aria-label="正在思考"><span aria-hidden="true">{label} </span><RunningDots className="thinking-dots" /></span>;
}
