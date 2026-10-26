import { TerminalType } from './terminal-detector-utils';
export declare abstract class TerminalSetupUtils {
    static setupITerm2(): Promise<string>;
    static setupAppleTerminal(): Promise<string>;
    static setupVSCode(editorName?: string): Promise<string>;
    static setupGhostty(): Promise<string>;
    static setupWezTerm(): Promise<string>;
    static setupWindowsTerminal(): Promise<string>;
    static setupKitty(): Promise<string>;
    static setupAlacritty(): Promise<string>;
    static setupWarp(): Promise<string>;
    static setup(terminalType: TerminalType): Promise<string>;
}
