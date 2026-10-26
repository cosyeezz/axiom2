import type { Session } from '../../vendor/cbc-core/node/index.js';
interface MediaReadOptions {
    label: 'Image' | 'Video' | 'Audio';
    signal?: AbortSignal;
    maxBytes?: number;
}
export declare function readMediaFile(input: string, session: Session | undefined, options: MediaReadOptions): Promise<{
    path: string;
    content: Buffer;
}>;
export {};
