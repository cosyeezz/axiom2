import type { AuthoredModDiagnostic } from './authored-mod-protocol';
/** V8's syntax frame names the supplied file; host stack frames are never source locations. */
export declare function authoredModDiagnostic(error: unknown, phase: AuthoredModDiagnostic['phase'], source?: {
    file: string;
    code: string;
}): AuthoredModDiagnostic;
