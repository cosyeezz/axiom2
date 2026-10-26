import type { Mods } from '../../vendor/cbc-plugins/node/index.js';
/** The shared Mods API; headless capability behavior is documented by the host. */
export type FunctionalHookApi = Mods.EngineInterface;
type Inputs = {
    [E in Mods.EventName]: Mods.Args<E>;
} & {
    'session.start': {
        cwd: string;
        surface: null;
        isInteractive: boolean;
    };
    'session.id': Record<never, never>;
    'session.cwd': Record<never, never>;
    'engine.create': {
        plugins: readonly string[];
    };
    'plugin.register': Mods.PluginRegisterInput;
};
type Results = Mods.ResultOf & {
    'session.start': {
        cwd: string;
    };
    'session.id': {
        value: string;
    } | {
        deny: string;
    };
    'session.cwd': {
        value: string;
    } | {
        deny: string;
    };
    'engine.create': Partial<FunctionalHookApi>;
    'plugin.register': Mods.PluginRegisterResult;
};
export type FunctionalHookEvent = Mods.EventName;
type Namespace = FunctionalHookEvent extends `${infer N}.${string}` ? N : never;
type PositivePattern = FunctionalHookEvent | `${Namespace}.*` | '*';
export type FunctionalHookPattern = PositivePattern | `!${PositivePattern}`;
type Selected<P extends FunctionalHookPattern> = P extends `!${infer Q extends PositivePattern}` ? Exclude<FunctionalHookEvent, Selected<Q>> : P extends '*' ? FunctionalHookEvent : P extends `${infer N}.*` ? Extract<FunctionalHookEvent, `${N}.${string}`> : Extract<P, FunctionalHookEvent>;
type Frozen<T> = T extends (...args: never[]) => unknown ? T : T extends object ? {
    readonly [K in keyof T]: Frozen<T[K]>;
} : T;
type Matcher<T> = {
    readonly [K in keyof T]?: Mods.MatcherValue<T[K]>;
};
type Narrow<T, M> = T extends object ? T & {
    [K in keyof M & keyof T]: M[K] extends string | number | boolean ? M[K] : T[K];
} : T;
type Input<P extends FunctionalHookPattern, M> = Narrow<Inputs[Selected<P>], M>;
type Result<P extends FunctionalHookPattern> = Results[Selected<P>];
/** Same next()/is()/catch() correlation as Mods, using the shared event vocabulary. */
export interface FunctionalHookNext<P extends FunctionalHookPattern, M = unknown> {
    <T extends string>(input: Input<P, M> & {
        tool: T;
    }): Promise<P extends 'tool.call' ? Mods.ToolCallResult<T> : Result<P>>;
    (input: Input<P, M>): Promise<Result<P>>;
    readonly event: Selected<P>;
    readonly signal: AbortSignal;
    readonly origin: Mods.Origin;
    readonly budget: Mods.NextBudget;
    readonly trace: readonly Mods.TraceEntry[];
    readonly is: <Q extends FunctionalHookPattern>(pattern: Q, input: unknown) => input is Frozen<Inputs[Extract<Selected<P>, Selected<Q>>]>;
}
type Hook<P extends FunctionalHookPattern, M = unknown> = (api: P extends 'engine.create' ? Record<string, never> : FunctionalHookApi, input: Frozen<Input<P, M>>, next: FunctionalHookNext<P, M>) => Result<P> | undefined | Promise<Result<P> | undefined>;
interface Registration<P extends FunctionalHookPattern, M> {
    readonly catch: (handler: (api: FunctionalHookApi, input: Frozen<Input<P, M>>, next: FunctionalHookNext<P, M> & {
        readonly error: Mods.HookFailure;
        readonly called: boolean;
    }) => Result<P> | undefined | Promise<Result<P> | undefined>) => void;
}
export interface FunctionalHookOn {
    <P extends FunctionalHookPattern>(pattern: P, hook: NoInfer<Hook<P>>): Registration<P, unknown>;
    <P extends FunctionalHookPattern, const M extends Matcher<Inputs[Selected<P>]>>(pattern: P, matcher: M, hook: NoInfer<Hook<P, M>>): Registration<P, M>;
}
/** Registration is awaited; event handlers are active only after it succeeds. */
export type FunctionalHooksRegister = (on: FunctionalHookOn, options: Mods.PluginOptions) => unknown;
export {};
