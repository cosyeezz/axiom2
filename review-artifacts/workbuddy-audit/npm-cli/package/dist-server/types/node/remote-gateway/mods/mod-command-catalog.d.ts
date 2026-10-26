/** Native CommandManager stores slash-prefixed names; public invocation takes the bare matcher name. */
export declare function modCommandCatalog(commands: readonly {
    name: string;
    description?: string;
    tags?: readonly string[];
}[]): Array<{
    name: string;
    description?: string;
}>;
