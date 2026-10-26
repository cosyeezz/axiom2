/**
 * A hardened vm context (an ECMAScript realm of its own) plus the boundary that keeps host
 * objects out of it.
 *
 * Rules, learned on the REPL sandbox and kept here for every worker:
 *   - no host-realm ECMAScript builtin is injected; the context is a full realm whose
 *     Function is bound by codeGeneration.strings:false;
 *   - every host function that enters the realm is harden()ed: a null [[Prototype]] on the
 *     function and on its own `prototype` object, so neither `fn.constructor` nor
 *     `fn.prototype.__proto__.constructor` reaches the host Function;
 *   - endowments are functions, plain objects and primitives; any other host object (array,
 *     Map, class instance) is refused at define time because its prototype chain is the host's;
 *   - realm-only capabilities (TextEncoder/TextDecoder) are bootstrapped inside the realm;
 *   - Error.prepareStackTrace is frozen to undefined inside the realm (the vm2 CallSite escape);
 *   - values handed to realm code are rebuilt inside the realm from JSON (`intoRealm`),
 *     promises realm code awaits are realm promises (`adopt`), errors are realm errors:
 *     a host object's prototype chain ends in the host Function, and
 *     `x.constructor.constructor('return process')()` runs outside the realm's lock.
 */
import { type Context } from 'node:vm';
export interface RealmOptions {
    /** `vm.createContext` name, visible in inspector and stack traces. */
    name: string;
    /** Globals the realm starts with: functions, plain objects (hardened, deeply) and primitives. */
    endowments?: Record<string, unknown>;
}
export interface RunOptions {
    filename?: string;
    /** Synchronous execution budget; see `vm.Script.runInContext`. */
    timeout?: number;
}
export interface Realm {
    readonly context: Context;
    /** The contextified global object; assign to it to define globals (prefer `define`). */
    readonly sandbox: Record<string, unknown>;
    /** Host value → realm value, rebuilt from JSON by the realm's own JSON.parse. Primitives pass through. */
    intoRealm(value: unknown): any;
    /** Realm value → host value, extracted by the realm's own JSON.stringify. */
    fromRealm(value: unknown): unknown;
    /** A realm Promise that settles with `intoRealm(value)` (or the raw value when `convert` is false) or a realm Error. */
    adopt(hostPromise: Promise<unknown>, convert?: boolean): Promise<any>;
    /** A realm Error carrying the host error's name and message. */
    makeError(error: unknown): Error;
    /** `Object.create(null)` made by the realm. */
    nullObject(): Record<string, unknown>;
    /** Compiles and runs `code` in the realm. */
    run(code: string, options?: RunOptions): unknown;
    /** Defines a global: functions and plain objects are hardened, other host objects are refused. */
    define(name: string, value: unknown): void;
}
/**
 * Cuts every host prototype chain a function carries into a realm: its own [[Prototype]], the
 * [[Prototype]] of its `prototype` object (function declarations, classes) and the function
 * members of that object (class methods and accessors). [[Call]] and [[Construct]] still work.
 * Generator functions are refused (they return host iterators). A bound function is replaced
 * by a plain wrapper: its [[Construct]] would build instances on the target's host `prototype`.
 */
export declare function harden<T>(fn: T): T;
/**
 * A null-prototype copy of `obj`: functions hardened, nested plain objects copied the same way,
 * primitives and realm values kept. Any other host object is refused, its chain is the host's.
 */
export declare function hardenObject(obj: Record<string, unknown>, path?: string): Record<string, unknown>;
export declare function createHardenedContext(options: RealmOptions): Realm;
//# sourceMappingURL=realm.d.ts.map