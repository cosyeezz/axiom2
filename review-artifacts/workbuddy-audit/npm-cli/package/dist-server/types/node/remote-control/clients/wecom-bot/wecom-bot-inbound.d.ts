/**
 * Sync peek of aibot_msg_callback text so the bridge can route (permission / slash)
 * and open a stream before media download awaits.
 */
import type { WecomBotMsgCallback } from './wecom-bot-types';
export declare function peekWecomCallbackText(body: WecomBotMsgCallback['body']): string;
export declare function composeWecomPrompt(text: string, mediaFiles: string[]): string;
