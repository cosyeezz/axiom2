import type { SelectionChange } from "../../shared/agent.js";
import type { Configuration } from "../../shared/protocol.js";
import { useScope } from "../transport.js";
import { TaskNotice } from "./TaskNotice.js";

const emptyConfig: Pick<Configuration, "available"> = { available: [] };

export function ModelChangeNotice({ change }: { change: SelectionChange }) {
  const config = useScope("configuration", emptyConfig);
  const { from, to } = change;
  const modelChanged = from.provider !== to.provider || from.id !== to.id;
  const model = (value: typeof from) => {
    const configured = config.available.find((m) => m.provider === value.provider && m.id === value.id);
    const providerName = configured?.providerName || config.available.find((m) => m.provider === value.provider)?.providerName || value.provider;
    // Old history may outlive a copied/duplicate configuration; its UUID is not an upstream model ID.
    const fallback = /^axiom-(copy|model)-/.test(value.id) ? "未知模型配置" : value.id;
    return `${providerName} / ${configured?.name || fallback}`;
  };
  const level = (value: typeof from) => value.thinking === "off" ? "none" : value.thinking;
  const parts = [modelChanged ? `模型：${model(from)} → ${model(to)}` : `模型：${model(to)}`];
  parts.push(from.thinking !== to.thinking
    ? `思考等级：${level(from)} → ${level(to)}` : `思考等级：${level(to)}`);
  return <TaskNotice message={{ id: "model-change", role: "notice", text: `后续请求生效 · ${parts.join("；")}` }} />;
}
