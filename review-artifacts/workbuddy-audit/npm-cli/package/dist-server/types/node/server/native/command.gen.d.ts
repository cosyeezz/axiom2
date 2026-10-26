import { Context, Effect, Layer } from 'effect';
import { InteractiveShellManagerImpl } from '../../command/bash-command-executor';
import { CommandManagerImpl } from '../../command/command-manager';
import { CustomCommandRendererImpl } from '../../command/custom-command-renderer';
import { McpPromptRendererImpl } from '../../command/mcp-prompt-renderer';
declare const InteractiveShellManagerImplKey_base: Context.ServiceClass<InteractiveShellManagerImplKey, "server/native/InteractiveShellManagerImpl", InteractiveShellManagerImpl>;
export declare class InteractiveShellManagerImplKey extends InteractiveShellManagerImplKey_base {
}
export declare const InteractiveShellManagerImplLayer: Layer.Layer<InteractiveShellManagerImplKey, never, never>;
declare const CommandManagerImplKey_base: Context.ServiceClass<CommandManagerImplKey, "server/native/CommandManagerImpl", CommandManagerImpl>;
export declare class CommandManagerImplKey extends CommandManagerImplKey_base {
}
export declare const CommandManagerImplLayer: Layer.Layer<CommandManagerImplKey, never, never>;
declare const CustomCommandRendererImplKey_base: Context.ServiceClass<CustomCommandRendererImplKey, "server/native/CustomCommandRendererImpl", CustomCommandRendererImpl>;
export declare class CustomCommandRendererImplKey extends CustomCommandRendererImplKey_base {
}
export declare const CustomCommandRendererImplLayer: Layer.Layer<CustomCommandRendererImplKey, never, never>;
declare const McpPromptRendererImplKey_base: Context.ServiceClass<McpPromptRendererImplKey, "server/native/McpPromptRendererImpl", McpPromptRendererImpl>;
export declare class McpPromptRendererImplKey extends McpPromptRendererImplKey_base {
}
export declare const McpPromptRendererImplLayer: Layer.Layer<McpPromptRendererImplKey, never, never>;
export declare const layer: Layer.Layer<InteractiveShellManagerImplKey | CommandManagerImplKey | CustomCommandRendererImplKey | McpPromptRendererImplKey, never, never>;
export declare const bridge: ({
    token: unknown;
    program: typeof InteractiveShellManagerImplKey;
    mode: "rebind";
} | {
    token: unknown;
    program: typeof CommandManagerImplKey;
    mode: "rebind";
} | {
    token: unknown;
    program: typeof CustomCommandRendererImplKey;
    mode: "rebind";
} | {
    token: unknown;
    program: typeof McpPromptRendererImplKey;
    mode: "rebind";
})[];
export declare const warmup: Effect.Effect<void, never, InteractiveShellManagerImplKey | CommandManagerImplKey | CustomCommandRendererImplKey | McpPromptRendererImplKey>;
export declare const deps: ReadonlyArray<string>;
export {};
