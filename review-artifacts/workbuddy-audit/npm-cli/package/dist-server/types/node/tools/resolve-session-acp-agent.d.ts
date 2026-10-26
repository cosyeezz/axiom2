import { type Session } from '../../vendor/cbc-core/node/index.js';
import { type AcpAgent } from '../acp/acp-protocol';
/**
 * 子代理的 `meta.acpConnectionId` 是创建时从主 session 拷的快照；Web 重连后主 session
 * 改绑新连接、旧 AcpAgent 被移除，运行中的子代理按旧 id 查不到。此时回退到提问实际投递的
 * 主 session（`findMainSession`）的当前连接，解析顺序与 SandboxWriteRuleGuard 一致（#89387）。
 */
export declare function resolveSessionAcpAgent(session: Session): AcpAgent | undefined;
