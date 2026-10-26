import { Readable } from 'node:stream';
export declare abstract class NetworkUtils {
    static downloadFileStream(url: string): Promise<Readable>;
}
