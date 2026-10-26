/**
 * 会话档技能 seam（形态 A）：`query({ fs })` 里 `~/.codebuddy/skills` 的技能
 * 随会话生效。激活期扫描（live-session-manager），读取点合并（tool-manager
 * 的清单面 + skill-tool 的执行面），同名以会话档优先（mcpServers 同判据）。
 * bin / ACP 从不绑定，合并是 no-op，行为不变。
 */
import type { Session } from '../../vendor/cbc-core/node/index.js';
import type { Skill } from '@genie/product';
/** Separate ownership from SDK/plugin session skills; closing Web UI cannot remove those. */
export declare function setWebUiSessionSkills(session: Session, skills: Skill[] | undefined, owner?: object): void;
/** 激活期绑定 / 钝化清除（live-session-manager 专用）。 */
export declare function setSessionSkills(session: Session, skills: Skill[] | undefined): void;
/** 当前 run 的会话档技能（root scope 解析——子代理沿用主会话）。 */
export declare function resolveSessionSkills(): Skill[] | undefined;
/** 按值读取（session-agent-view 的激活期/派发期解析，不依赖 ALS）。 */
export declare function getSessionSkills(session: Session): Skill[] | undefined;
/**
 * 纯合并：会话档叠加进程档（同名以会话档优先）。ALS 面（执行）与按值面
 * （session-agent-view 清单）必须共用这一个函数——两面展示/命中同一实体集
 * 是 #67209 判例的会话档延伸。
 */
export declare function mergeSkillLists(sessionSkills: Skill[] | undefined, processSkills: Skill[] | undefined): Skill[];
/**
 * 进程档技能之上叠加会话档（同名以会话档优先）。无绑定时原样返回进程档，
 * 消费点无需感知形态差异。
 */
export declare function mergeSessionSkills(processSkills: Skill[] | undefined, session?: Session): Skill[];
