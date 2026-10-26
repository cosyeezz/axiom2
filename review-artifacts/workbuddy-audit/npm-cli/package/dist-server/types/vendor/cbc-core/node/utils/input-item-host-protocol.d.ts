import type { UserMessageItem } from '../../../cbc-shared/node/index.js';
export declare const InputItemHost: unique symbol;
export interface InputItemHost {
    formatHookMessage(message: string): string;
    createUserMessageWithImage(text: string, imagePath: string, imageFormat?: string): Promise<UserMessageItem>;
    createUserMessageWithMultipleImages(text: string, imageMap: Map<number, {
        path: string;
        format: string;
    }>): Promise<UserMessageItem>;
}
//# sourceMappingURL=input-item-host-protocol.d.ts.map