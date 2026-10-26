/**
 * Terminal serializer for xterm headless terminal
 * Extracts screen content with ANSI color codes preserved
 */
import type { Terminal } from '@xterm/headless';
export interface AnsiToken {
    text: string;
    bold: boolean;
    italic: boolean;
    underline: boolean;
    dim: boolean;
    inverse: boolean;
    fg: string;
    bg: string;
}
export type AnsiLine = AnsiToken[];
export type AnsiOutput = AnsiLine[];
export declare const enum ColorMode {
    DEFAULT = 0,
    PALETTE = 1,
    RGB = 2
}
/**
 * Serialize terminal content to structured AnsiOutput
 */
export declare function serializeTerminalToObject(terminal: Terminal): AnsiOutput;
