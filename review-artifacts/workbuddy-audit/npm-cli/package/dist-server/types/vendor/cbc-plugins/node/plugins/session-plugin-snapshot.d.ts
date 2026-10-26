import { type Session } from '../../../cbc-core/node/index.js';
import type { ActivePluginRuntimeEntry } from './plugin-protocol';
export declare function setSessionPluginSnapshot(session: Session, plugins: readonly ActivePluginRuntimeEntry[] | undefined): void;
export declare function getSessionPluginSnapshot(session: Session | undefined): readonly ActivePluginRuntimeEntry[] | undefined;
export declare function currentSessionPluginSnapshot(): readonly ActivePluginRuntimeEntry[] | undefined;
//# sourceMappingURL=session-plugin-snapshot.d.ts.map