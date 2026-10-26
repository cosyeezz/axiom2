import { MOD_NAVIGATION_VIEWS } from './mod-client';
export type ModActivationEvent = 'startup' | `onView:${typeof MOD_NAVIGATION_VIEWS[number]}` | `onFile:${string}` | `onTheme:${string}`;
/** Absence preserves legacy startup behavior; an empty set means explicit use or dependency activation only. */
export declare function parseModActivationEvents(value: unknown): ModActivationEvent[] | undefined;
//# sourceMappingURL=mod-activation.d.ts.map