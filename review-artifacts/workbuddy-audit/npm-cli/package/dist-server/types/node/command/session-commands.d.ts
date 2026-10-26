/**
 * 会话档自定义命令 seam（形态 A，与 session-skills 同构）：`query({ fs })` 里
 * `~/.codebuddy/commands` 的命令随会话生效。激活期扫描（live-session-manager），
 * 读取点合并（session-agent-view 的 SlashCommand 清单面 + slash-command-tool 的
 * 执行面），同名以会话档优先。bin / ACP 从不绑定，合并是 no-op，行为不变。
 */
import type { Command } from '@genie/product';
import type { Session } from '../../vendor/cbc-core/node/index.js';
/** 激活期绑定 / 钝化清除（live-session-manager 专用）。 */
export declare function setSessionCommands(session: Session, commands: Command[] | undefined): void;
/** 当前 run 的会话档命令（root scope 解析——子代理沿用主会话）。 */
export declare function resolveSessionCommands(): Command[] | undefined;
/** 按值读取（session-agent-view 的激活期/派发期解析，不依赖 ALS）。 */
export declare function getSessionCommands(session: Session): Command[] | undefined;
/** 纯合并：会话档叠加进程档（同名以会话档优先）。清单面与执行面共用。 */
export declare function mergeCommandLists(sessionCommands: Command[] | undefined, processCommands: Command[] | undefined): Command[];
/** 进程档命令之上叠加会话档（ALS 解析，执行面用）。无绑定时原样返回。 */
export declare function mergeSessionCommands(processCommands: Command[] | undefined): Command[];
