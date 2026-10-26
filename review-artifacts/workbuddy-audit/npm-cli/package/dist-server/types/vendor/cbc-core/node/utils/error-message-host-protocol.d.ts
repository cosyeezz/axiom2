import type { ErrorInfo } from './error-utils';
export declare const ErrorMessageHost: unique symbol;
export interface ErrorMessageHost {
    formatErrorMessage(error: ErrorInfo): string;
}
//# sourceMappingURL=error-message-host-protocol.d.ts.map