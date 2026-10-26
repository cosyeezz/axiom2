import { type ToolResult } from '../tools/tool-protocol';
import { shouldDetachCoordinatorSpawn } from './session-flags';
import type { PreparedCoordinatorSpawn, SpawnDetachedContext, SpawnDetachedInput } from './types';
export { shouldDetachCoordinatorSpawn };
/** Agent catalog 读取或取消挂死会堵住同会话派工链。 */
export declare const SPAWN_OPERATION_TIMEOUT_MS = 8000;
export declare function prepareCoordinatorSpawn(session: SpawnDetachedContext['session'], input: SpawnDetachedInput): PreparedCoordinatorSpawn;
/** detached spawn。失败必须 return ToolResult，禁止 throw（同批 Promise.all）。 */
export declare function spawnDetachedNoTeam(ctx: SpawnDetachedContext): Promise<ToolResult>;
