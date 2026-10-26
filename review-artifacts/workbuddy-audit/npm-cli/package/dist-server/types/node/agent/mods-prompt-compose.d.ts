export interface PromptComposeFacts {
    readonly model: string;
    readonly tools: readonly string[];
    readonly surfaces: readonly string[];
    readonly outputStyle: {
        readonly name: string;
        readonly isKeepingCodingInstructions: boolean;
    } | null;
}
interface Section {
    id: string;
    text: string;
    scope: 'shared' | 'session';
}
/** What core answers a plugin's own `$.prompt.compose()`: the last prompt rendered. */
export declare function lastComposedSections(): readonly Section[];
export declare function composeThroughMods(own: string, facts: PromptComposeFacts): Promise<string>;
export {};
