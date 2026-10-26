import { type Session } from '../../vendor/cbc-core/node/index.js';
import type { Mods } from '../../vendor/cbc-plugins/node/index.js';
/** Read-only projection of SessionManager's latest admitted query, without a cache. */
export declare function createModsPromptReadBindings(getSession: () => Session): Pick<Mods.HostBindings, 'readPrompt'>;
