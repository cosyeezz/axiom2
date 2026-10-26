import { type BackgroundTask, type Session } from '../../vendor/cbc-core/node/index.js';
import { Effect } from 'effect';
import { ToolManager } from '../tools/tool-protocol';
/**
 * Background work that reports its output, exit and completion notice through
 * the resident Session: idle passivation waits for the root's, explicit close
 * stops the whole tree's. Team members follow their registry's lifecycle instead.
 */
export declare function runningBackgroundTasks(tools: Pick<ToolManager, 'getBackgroundTasks'> | undefined, owners: ReadonlySet<string>): BackgroundTask[];
/** Stop this root's whole tree and join it, using the backend's existing settlement barriers. */
export declare const closeSessionChildren: (session: Session) => Effect.Effect<void, never, import("./services").ComponentResolver>;
