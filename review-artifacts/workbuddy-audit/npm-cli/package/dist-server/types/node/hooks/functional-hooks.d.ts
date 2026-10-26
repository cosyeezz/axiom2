import { type ModsBridge, type ModsExecutionContext, type Session } from '../../vendor/cbc-core/node/index.js';
import { Mods } from '../../vendor/cbc-plugins/node/index.js';
import type { FunctionalHooksRegister } from './functional-hooks-protocol';
export interface FunctionalHooks {
    readonly bridge: ModsBridge;
}
export interface FunctionalHooksHost {
    readonly name: string;
    readonly signal: AbortSignal;
    readonly report: (message: string) => void;
    readonly getSession: () => ModsExecutionContext | undefined;
}
/** Existing dispatch sites can use the scoped runtime without the CLI singleton. */
export declare function currentFunctionalHooksRuntime(): Pick<Mods.ModsRuntime, 'dispatch'> | undefined;
/** A Server turn ends at query settlement, including approval continuations. */
export declare function withFunctionalHookTurn<T extends {
    stopReason: string;
    assistantText: string;
}>(turnId: string, run: () => Promise<T>, text?: string): Promise<T>;
export declare function prepareSessionFunctionalHooks(session: Session, bridge?: ModsBridge): Promise<void>;
export declare function closeSessionFunctionalHooks(session: Session): Promise<void>;
/** Host registration is application-owned; plugin registrations belong to a mounted session. */
export declare function createFunctionalHooks(register: FunctionalHooksRegister, host: FunctionalHooksHost): Promise<FunctionalHooks>;
