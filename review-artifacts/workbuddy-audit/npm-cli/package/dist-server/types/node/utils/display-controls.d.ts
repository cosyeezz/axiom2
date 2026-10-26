/**
 * 剥离模型产出的展示文本里的控制字符，供交互面板等直接写终端的渲染入口使用。
 * 典型是裸 CR：终端按回车处理，光标回到列 0 后覆盖行首内容。\r\n 去掉 \r 后自然折叠为 \n。
 */
export declare function stripDisplayControls(text: string): string;
/**
 * 与 stripDisplayControls 同一字符集，但转义为可见形式（\r、\x08 …）而不是删除。
 * 用于待执行内容（如 Bash 命令）的授权展示：既不能让 CR / BS 改写屏幕上
 * 已显示的命令，也不能把实际会执行的字符藏起来。
 */
export declare function escapeDisplayControls(text: string): string;
