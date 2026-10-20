import { RunningDots } from "./RunningDots.js";
import "../styles/thinking.css";

export function ThinkingDots() {
  return <span className="thinking-indicator" role="img" aria-label="正在思考"><RunningDots className="thinking-dots" /></span>;
}
