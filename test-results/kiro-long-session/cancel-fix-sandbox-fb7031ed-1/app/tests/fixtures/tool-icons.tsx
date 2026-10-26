import { useEffect } from "react";
import { createRoot } from "react-dom/client";
import { Icons } from "../../src/client/components.js";
import { ActivityGroup, Tool } from "../../src/client/chat/ToolActivity.js";
import { ProcessIcon } from "../../src/client/chat/ProcessIcon.js";
import { acceptSnapshot } from "../../src/client/transport.js";
import { messageScope, type ChatMessage } from "../../src/shared/agent.js";
import { toolSummary } from "../../src/shared/tool-summary.js";
import "../../src/client/styles/tokens.css";
import "../../src/client/styles/workbench.css";
import "../../src/client/styles/chat.css";
import "../../src/client/styles/icon-geometry.css";
import "../../src/client/styles/theme.css";

const scope = { workspaceId: "icon-fixture", sessionId: "icon-fixture" };
const names = ["memory_query", "codemode", "tool_search", "mcp__chosen__ping", "list_mcp_resources",
  "list_mcp_resource_templates", "read_mcp_resource", "grep", "fetch_content", "custom_tool",
  "functions.memory_query", "find", "ls", "web_search", "source_check", "get_search_content",
  "read", "edit", "write", "bash"];
const messages: ChatMessage[] = names.map((name, i) => ({ id: `message-${i}`, role: "assistant", text: "", streaming: true,
  calls: [{ id: `call-${i}`, name, input: '{"truncated":', summary: { label: name, icon: "tool", target: "保留的完整摘要", detail: "完整详情" } }] }));
function Fixture() {
  // Child subscriptions must exist before the transport accepts session snapshots.
  useEffect(() => {
    messages.forEach((message, i) => {
      acceptSnapshot({ type: "snapshot", streamId: "icon-fixture", seq: i + 1,
        scope: messageScope(scope, message.id), data: message });
      const result: ChatMessage = { id: `tool-call-${i}`, role: "toolResult", text: "", status: "running" };
      acceptSnapshot({ type: "snapshot", streamId: "icon-fixture", seq: messages.length + i + 1,
        scope: messageScope(scope, result.id), data: result });
    });
  }, []);
  return <><Icons /><main className="thread-content">
  <div className="existing-icons">既有样式参照：{(["read", "edit", "write", "bash", "think"] as const).map(kind => <span key={kind}><ProcessIcon kind={kind} />{kind}</span>)}</div>
  {messages.map((message, i) => <section key={message.id} data-case={i} data-name={names[i]} data-label={toolSummary(message.calls![0]).label}>
    <ActivityGroup scope={scope} messageIds={[message.id]}><Tool scope={scope} message={message} call={message.calls![0]} /></ActivityGroup>
  </section>)}
</main></>;
}
createRoot(document.getElementById("root")!).render(<Fixture />);
