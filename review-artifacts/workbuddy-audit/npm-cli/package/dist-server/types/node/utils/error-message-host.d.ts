import { type ErrorInfo, ErrorMessageHost } from '../../vendor/cbc-core/node/index.js';
export declare class ErrorMessageHostImpl implements ErrorMessageHost {
    formatErrorMessage(error: ErrorInfo): string;
}
