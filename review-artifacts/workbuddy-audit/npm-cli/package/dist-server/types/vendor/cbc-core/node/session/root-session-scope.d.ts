import { AsyncLocalStorage } from 'node:async_hooks';
import type { Session } from './session-protocol';
export declare function registerRootSessionResolver(resolver: () => Session | undefined): void;
export declare const rootScope: AsyncLocalStorage<Session>;
export declare function currentRunSession(): Session | undefined;
export declare function rootRunSession(): Session | undefined;
//# sourceMappingURL=root-session-scope.d.ts.map