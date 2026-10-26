import { Writable } from 'node:stream';
import { FileSystem } from '@genie/runtime';
export declare function extractTo(fs: FileSystem, path: string): Promise<Writable>;
export declare function unzipTo(fs: FileSystem, path: string): Promise<Writable>;
export declare function ensure(fs: FileSystem, ...paths: string[]): Promise<string>;
export declare function linkOrCopyFile(fs: FileSystem, src: string, dest: string): Promise<void>;
export declare function makeExecutable(fs: FileSystem, path: string): Promise<void>;
