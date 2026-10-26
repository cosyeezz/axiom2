import { InputItemHost } from '../../vendor/cbc-core/node/index.js';
import type { UserMessageItem } from '../../vendor/cbc-shared/node/index.js';
export declare class InputItemHostImpl implements InputItemHost {
    formatHookMessage(message: string): string;
    private getImageMimeType;
    createUserMessageWithImage(text: string, imagePath: string, imageFormat?: string): Promise<UserMessageItem>;
    createUserMessageWithMultipleImages(text: string, imageMap: Map<number, {
        path: string;
        format: string;
    }>): Promise<UserMessageItem>;
}
