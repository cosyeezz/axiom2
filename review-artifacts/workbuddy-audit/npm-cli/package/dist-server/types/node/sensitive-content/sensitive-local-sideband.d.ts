import type { CipherEntry, SensitiveProtectionMetadata } from './sensitive-content-protocol';
export declare const CODEBUDDY_LOCAL_KEY = "__codebuddyLocal";
export interface SensitiveLocalSideband {
    sensitiveProtection?: SensitiveProtectionMetadata;
    sensitiveDisplayText?: string;
    sensitiveUserInputReviewed?: true;
}
/** Pair the detached history copy with the SDK item that will feed the next model request. */
export declare function linkSensitiveRuntimeProjection(historyItem: object, runtimeItem: object): void;
export declare function getSensitiveRuntimeProjection(historyItem: object): object | undefined;
/** Consume the pair once at history admission so runtime plaintext cannot outlive tool execution. */
export declare function takeSensitiveRuntimeProjection(historyItem: object): object | undefined;
export declare function getSensitiveLocalSideband(value: unknown): SensitiveLocalSideband | undefined;
export declare function setSensitiveLocalSideband(target: unknown, patch: SensitiveLocalSideband): void;
export declare function clearSensitiveLocalSideband(target: unknown): void;
export declare function collectSensitiveLocalCiphertexts(source: unknown): string[];
/** Collect complete local cipher mappings without querying Sandbox Center. */
export declare function collectSensitiveLocalEntries(source: unknown): CipherEntry[] | undefined;
export declare function collectSensitiveLocalMetadata(source: unknown, collect: (candidate: unknown) => void): void;
/** Remove every CodeBuddy-local field at the final provider boundary. */
export declare function stripCodebuddyLocalFields<T>(source: T): T;
