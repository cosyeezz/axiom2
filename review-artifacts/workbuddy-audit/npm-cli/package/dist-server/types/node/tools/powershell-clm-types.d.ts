/**
 * PowerShell Constrained Language Mode (CLM) allowed types.
 *
 * Microsoft's CLM restricts .NET type usage to this allowlist when PowerShell
 * runs under AppLocker/WDAC system lockdown. Any type NOT in this set is
 * considered unsafe for untrusted code execution.
 *
 * We invert this: type literals not in this set -> ask. One canonical check
 * replaces enumerating individual dangerous types (named pipes, reflection,
 * process spawning, P/Invoke marshaling, etc.). Microsoft maintains the list.
 *
 * Source: https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/about/about_language_modes
 *
 * Aligned with Claude Code's clmTypes.ts.
 *
 * Normalization: entries stored lowercase, short AND full names where both
 * exist (PS resolves type accelerators like [int] -> System.Int32 at runtime;
 * we match against the literal text from the command).
 */
export declare const CLM_ALLOWED_TYPES: ReadonlySet<string>;
/**
 * Normalize a type name from command text.
 * Handles array suffix ([]) and generic brackets.
 */
export declare function normalizeTypeName(name: string): string;
/**
 * True if typeName is in Microsoft's CLM allowlist.
 * Types NOT in this set trigger ask — they access system APIs CLM blocks.
 */
export declare function isClmAllowedType(typeName: string): boolean;
