import { useState } from "react";
import { useScope } from "../transport.js";
import { Icon } from "../components.js";
import {
  agentScope,
  emptyAgent,
  runLabels,
} from "../../shared/agent.js";
import type { Scope } from "../../shared/protocol.js";
export function Environment({ scope }: { scope: Scope }) {
  const info = useScope(agentScope(scope), emptyAgent);
  const [open, setOpen] = useState(false);
  return (
    <section className="session-init" aria-label="会话初始化信息">
      <details className="session-environment" onToggle={(event) => { if (event.target === event.currentTarget) setOpen(event.currentTarget.open); }}>
        <summary>
          <Icon name="chevron" />
          <span>会话环境</span>
          <small>
            {info.task ? "子会话" : "主会话"} ·{" "}
            {info.run ? runLabels[info.run.status] : "尚未运行"}
          </small>
        </summary>
        {open && <><header className="session-init-head">
          <span>会话初始化</span>
          <span>
            {info.run
              ? `${info.run.selection.provider} / ${info.run.selection.id}`
              : "首次发送时加载 pi"}
          </span>
        </header>
        <div className="session-init-body">
          <p>
            {info.environment
              ? `工作目录：${info.environment.cwd}`
              : "首次发送时加载模型、项目资源与工具。"}
          </p>
          {info.environment && (
            <>
              <p>工具：{info.environment.tools.join("、") || "无"}</p>
              <p>
                技能：{info.environment.skills.join("、") || "无"} ·
                已加载扩展：{info.environment.extensions}
              </p>
              {info.environment.retry && <p>
                自动重试：{info.environment.retry.enabled ? `最多 ${info.environment.retry.maxRetries} 次，基础等待 ${info.environment.retry.baseDelayMs / 1000} 秒` : "已关闭"}
                {`；会话等待上限 ${info.environment.retry.maxAgentDelayMs / 1000} 秒；供应商层 ${info.environment.retry.provider.maxRetries ?? 0} 次`}
              </p>}
              {info.environment.warnings.map((w, i) => (
                <p key={i}>{w}</p>
              ))}
            </>
          )}
          <p>系统提示词</p>
          {typeof info.environment?.systemPrompt === "string" ? (
            <pre className="session-system-prompt" aria-label="系统提示词">
              {info.environment.systemPrompt || "（空）"}
            </pre>
          ) : (
            <p>{info.environment
              ? "此会话尚未记录系统提示词，下次执行时加载并展示。"
              : "尚未初始化，首次发送后展示实际生效的系统提示词。"}</p>
          )}
        </div></>}
      </details>
    </section>
  );
}
