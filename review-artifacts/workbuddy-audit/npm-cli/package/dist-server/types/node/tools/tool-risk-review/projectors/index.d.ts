import { type ToolRiskProjector } from '../projector-registry';
import type { InScopeBuiltinToolName } from '../scope';
export declare const BUILTIN_PROJECTORS: readonly ToolRiskProjector[];
export declare function getBuiltinProjector(toolName: InScopeBuiltinToolName): ToolRiskProjector;
export declare const builtinProjectorRegistry: import("../projector-registry").ToolRiskProjectorRegistry;
