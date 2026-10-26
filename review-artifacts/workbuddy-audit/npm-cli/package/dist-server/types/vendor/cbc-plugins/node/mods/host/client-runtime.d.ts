import type { SerializedElement } from './render-registry';
export interface ClientInstanceOptions {
    /** `compileClientModule` 的 CJS 产物。 */
    readonly code: string;
    readonly module: string;
    readonly props: unknown;
    readonly columns: number;
    readonly rows: number;
    /** 每一帧画出的树（与上一帧相同则不回调）。 */
    readonly onTree: (tree: SerializedElement) => void;
    /** `surface.post(data)`：交给宿主转成 `ui.message`。 */
    readonly onPost?: (data: unknown) => void;
    /** 卸载原因（加载失败、抛错、超时、越界）。 */
    readonly onFail: (reason: string) => void;
}
export interface ClientInstance {
    setProps(props: unknown): void;
    resize(columns: number, rows: number): void;
    dispose(): void;
}
/** 起一个 `Client` 实例。失败经 `onFail` 报告；返回的句柄在失败后仍可安全调用。 */
export declare function createClientInstance(options: ClientInstanceOptions): ClientInstance;
//# sourceMappingURL=client-runtime.d.ts.map