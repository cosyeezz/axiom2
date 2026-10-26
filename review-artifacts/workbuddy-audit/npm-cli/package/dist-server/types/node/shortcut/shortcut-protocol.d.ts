import { Disposable, MaybePromise } from '@celljs/core';
export interface ShortcutHandler {
    id: string;
    keyCode: string;
    handler: () => MaybePromise<void>;
    description?: string;
}
export interface ShortcutInfo {
    keyCode: string;
    description?: string;
}
export declare const ShortcutManager: unique symbol;
export interface ShortcutManager {
    register(keyCode: string, handler: () => MaybePromise<void>, description?: string): Disposable;
    getShortcuts(): ShortcutInfo[];
    /** 分发一个输入序列到匹配的快捷键 handler（由 TUI 的 useShortcutBridge 调用） */
    dispatch(sequence: string): void;
}
export declare const TtyInputService: unique symbol;
export interface TtyInputService {
    getInputStream(): import('tty').ReadStream | undefined;
    dispose(): void;
}
export declare const KEY_CODES: {
    readonly CTRL_B: "\u0002";
    readonly CTRL_C: "\u0003";
    readonly CTRL_D: "\u0004";
    readonly CTRL_Z: "\u001A";
    readonly CTRL_L: "\f";
    readonly CTRL_R: "\u0012";
    readonly CTRL_U: "\u0015";
    readonly CTRL_K: "\v";
    readonly ESC: "\u001B";
    readonly TAB: "\t";
    readonly ENTER: "\r";
    readonly BACKSPACE: "";
    readonly ARROW_UP: "\u001B[A";
    readonly ARROW_DOWN: "\u001B[B";
    readonly ARROW_LEFT: "\u001B[D";
    readonly ARROW_RIGHT: "\u001B[C";
};
