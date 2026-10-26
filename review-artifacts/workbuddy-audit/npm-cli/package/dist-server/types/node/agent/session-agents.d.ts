/**
 * 会话档自定义 agent 定义 seam（#108461 D6）：宿主经 `QueryOptions.agents` 注入的
 * 自定义 agent（形态对齐 stream-json `initialize.agents`），转成 Product Agent 配置后
 * 随会话生效——可被 `QueryOptions.agent` 选为主席位、也可作为 subagent 派发（asTool），
 * 仅对该会话可见、不跨会话泄漏。
 *
 * 与 session-skills / session-commands 同构：`WeakMap<Session>` 侧表 + 激活期绑定 /
 * 钝化清除。**解析走 `rootRunSession()`（查询根）而非逐 run**——session agents 是
 * 查询级资源，子代理应沿用父查询的自定义 agent 目录（与 skills/commands 同理，
 * 区别于「仅主轮」的 persona/systemPrompt）。消费点在 AgentManager 的 get /
 * getAgentConfig / getAll(Configs)：先查会话档、未命中回落进程 agentMap。
 * bin / 无注入时回落进程档，行为不变。
 */
import type { Agent } from '@genie/product';
import type { Session } from '../../vendor/cbc-core/node/index.js';
/** 激活期绑定 / 钝化清除（live-session-manager 专用）。空数组按无绑定处理。 */
export declare function setSessionAgents(session: Session, agents: Agent[] | undefined): void;
/** 按值读取该会话注入的 agent 配置。 */
export declare function getSessionAgents(session: Session | undefined): Agent[] | undefined;
/** 当前 run 的会话档 agent 配置（root scope 解析——子代理沿用主会话，同 session-skills）。 */
export declare function resolveSessionAgents(): Agent[] | undefined;
/** 当前会话按名查一个注入 agent 的配置；未命中返回 undefined。 */
export declare function findSessionAgentConfig(name: string): Agent | undefined;
/**
 * 会话档注入 agent 叠加进程 agent 列表（同名以会话档优先——宿主显式意图）。
 * 无注入时原样返回进程列表，消费点（getAll / getAllConfigs）无需感知形态差异。
 */
export declare function mergeSessionAgentList(processAgents: Agent[], sessionAgents: Agent[] | undefined): Agent[];
