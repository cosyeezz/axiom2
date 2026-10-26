import type { Register } from '../types';
export declare function viewHandlerOwner(fn: object): string | undefined;
export declare function viewElementOwner(node: object): string | undefined;
export declare function ownViewHandler(fn: object, plugin: string): void;
export declare function ownViewElement(node: object, plugin: string): void;
/** A membrane in both directions: no host object, promise or error enters mod code. */
export declare function sandboxViewModule(code: string, plugin: string, log: (text: string) => void): Register;
//# sourceMappingURL=sandbox.d.ts.map