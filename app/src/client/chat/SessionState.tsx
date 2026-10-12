import { useState } from "react";
import { command, useScope } from "../transport.js";
import { Icon } from "../components.js";
import {
  agentScope,
  emptyAgent,
  running,
  runLabels,
} from "../../shared/agent.js";
import { taskLabels } from "../../shared/tasks.js";
import type { Scope } from "../../shared/protocol.js";
export function Environment({ scope }: { scope: Scope }) {
  const info = useScope(agentScope(scope), emptyAgent),
    [error, setError] = useState("");
  return (
    <section className="session-init" aria-label="会话初始化信息">
      <details className="session-environment">
        <summary>
          <Icon name="chevron" />
          <span>会话环境</span>
          <small>
            {info.task ? "子会话" : "主会话"} ·{" "}
            {info.run ? runLabels[info.run.status] : "尚未运行"}
          </small>
        </summary>
        <header className="session-init-head">
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
              : "尚未加载模型、系统提示词与工具；请先选择可用模型。"}
          </p>
          {info.environment && (
            <>
              <p>工具：{info.environment.tools.join("、") || "无"}</p>
              <p>
                技能：{info.environment.skills.join("、") || "无"} ·
                已加载扩展：{info.environment.extensions}
              </p>
              {info.environment.warnings.map((w, i) => (
                <p key={i}>{w}</p>
              ))}
            </>
          )}
          <button
            className="btn"
            disabled={running(info.run)}
            onClick={async () => {
              if (
                !confirm(
                  "授权加载此项目的 pi 设置、技能、扩展与依赖？项目扩展可以执行任意代码。仅应信任你审查过的项目。",
                )
              )
                return;
              try {
                await command(
                  "agent.trust",
                  { trusted: true, confirmed: true },
                  scope,
                );
                setError("已授权，下次执行按 pi 规则加载。");
              } catch (e) {
                setError((e as Error).message);
              }
            }}
          >
            授权项目资源
          </button>
          <p role="status">{error}</p>
        </div>
      </details>
    </section>
  );
}
export function RunState({ scope }: { scope: Scope }) {
  const info = useScope(agentScope(scope), emptyAgent),
    [error, setError] = useState("");
  if (!info.run)
    return info.task ? (
      <p className="run-state" role="status">
        {taskLabels[info.task.status]}
      </p>
    ) : null;
  return (
    <div className={running(info.run) ? "run-state" : "meta"} role="status">
      {running(info.run) && <span className="run-spinner" />}
      <span>
        {info.phase && running(info.run)
          ? info.phase
          : info.task
            ? taskLabels[info.task.status]
            : runLabels[info.run.status]}
        {info.run.error && ` · ${info.run.error}`}
      </span>
      {!running(info.run) && info.run.cleanup === "unconfirmed" && (
        <button
          className="btn"
          onClick={async () => {
            if (
              !confirm(
                "我已检查并终止上次执行可能残留的命令和进程。确认后才允许继续；这不会回滚文件。",
              )
            )
              return;
            try {
              await command(
                "agent.confirm-cleanup",
                { confirmed: true, runId: info.run!.id },
                scope,
              );
            } catch (e) {
              setError((e as Error).message);
            }
          }}
        >
          确认已清理
        </button>
      )}
      {error}
    </div>
  );
}
