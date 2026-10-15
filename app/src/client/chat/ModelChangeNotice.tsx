import type { SelectionChange } from "../../shared/agent.js";
import { TaskNotice } from "./TaskNotice.js";

export function ModelChangeNotice({ change }: { change: SelectionChange }) {
  const { from, to } = change;
  const modelChanged = from.provider !== to.provider || from.id !== to.id;
  const model = (value: typeof from) => `${value.provider} / ${value.id}`;
  const level = (value: typeof from) => value.thinking === "off" ? "none" : value.thinking;
  const parts = [modelChanged ? `模型：${model(from)} → ${model(to)}` : `模型：${model(to)}`];
  parts.push(from.thinking !== to.thinking
    ? `思考等级：${level(from)} → ${level(to)}` : `思考等级：${level(to)}`);
  return <TaskNotice message={{ id: "model-change", role: "notice", text: `后续请求生效 · ${parts.join("；")}` }} />;
}
