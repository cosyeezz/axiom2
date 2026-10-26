/** 测试钩子：直接读当前 scale，便于断言。 */
export declare function getScreenshotScaleForTest(): {
    x: number;
    y: number;
};
/** 测试钩子：手动重置 scale（spec 用）。 */
export declare function __resetScreenshotScaleForTest(): void;
export type ComputerUseAction = 'screenshot' | 'left_click' | 'right_click' | 'middle_click' | 'double_click' | 'triple_click' | 'mouse_move' | 'left_click_drag' | 'type' | 'key' | 'hold_key' | 'scroll' | 'wait' | 'cursor_position';
export type ScrollDirection = 'up' | 'down' | 'left' | 'right';
export interface ScreenshotResult {
    action: 'screenshot';
    screenshot_path: string;
}
export interface ClickResult {
    action: 'left_click' | 'right_click' | 'middle_click' | 'double_click' | 'triple_click' | 'mouse_move';
    x: number;
    y: number;
}
export interface DragResult {
    action: 'left_click_drag';
    start_x: number;
    start_y: number;
    end_x: number;
    end_y: number;
}
export interface TypeResult {
    action: 'type';
    text_length: number;
}
export interface KeyResult {
    action: 'key';
    text: string;
}
export interface HoldKeyResult {
    action: 'hold_key';
    text: string;
    duration: number;
}
export interface ScrollResult {
    action: 'scroll';
    x: number;
    y: number;
    scroll_direction: ScrollDirection;
    scroll_amount: number;
}
export interface WaitResult {
    action: 'wait';
    duration: number;
}
export interface CursorPositionResult {
    action: 'cursor_position';
    x: number;
    y: number;
}
export type ComputerUseResult = ScreenshotResult | ClickResult | DragResult | TypeResult | KeyResult | HoldKeyResult | ScrollResult | WaitResult | CursorPositionResult;
/**
 * 截图实现。通过 `/usr/sbin/screencapture -x -t jpg -T 0 <out>` 调用系统截图工具。
 *
 * 参数：
 *   -x: 不播放快门音（避免打扰用户）
 *   -t jpg: 输出 jpeg（文件小、加载快，模型推理足够）
 *   -T 0: 零延迟截图
 *   -D <id>: 可选，指定显示器
 */
export declare function takeScreenshot(displayId?: number): Promise<ScreenshotResult>;
/**
 * 鼠标点击/移动。优先用 cliclick（快速精准），未安装时 fallback 到 AppleScript。
 * AppleScript 的 `click at {x,y}` 在部分 macOS 版本行为不稳定（需要 System Events 焦点），
 * 但作为 fallback 可用。
 *
 * middle_click / triple_click 仅 cliclick 支持；无 cliclick 时抛错。
 */
export declare function mouseAction(action: ClickResult['action'], x: number, y: number): Promise<ClickResult>;
/**
 * 左键拖拽 (Anthropic left_click_drag)。仅 cliclick 支持；需要 3 步：按下→移动→松开。
 */
export declare function leftClickDrag(startX: number, startY: number, endX: number, endY: number): Promise<DragResult>;
/**
 * 文本输入。用 AppleScript `keystroke` 原生支持任意 Unicode 字符（含中日韩）。
 * cliclick 的 t: 对非 ASCII 支持不完整，所以这里统一走 osascript。
 *
 * 多行：AppleScript 双引号字面量不能含裸换行/CR，直接拼进去会 syntax error。
 * 按 \n 拆段，段与段之间发 `keystroke return`（key code 36），匹配"真实按回车换行"语义。
 * `\r` 归一化成 `\n`；`\t` 交给 keystroke 原生（AppleScript 字面量支持 tab 字符）。
 */
export declare function typeText(text: string): Promise<TypeResult>;
/**
 * 按键/快捷键。接受 xdotool 风格字符串如 `cmd+shift+a` 或单个键如 `escape` / `return`。
 */
export declare function pressKey(text: string): Promise<KeyResult>;
/**
 * 按住某键指定秒数（Anthropic hold_key）。
 *
 * macOS 下最稳定的实现是 keystroke + 循环重复（按键自动重复速率由系统控制）。
 * 为了精确控制时长，改用 AppleScript 的 `key down` + delay + `key up` 模式。
 * 仅支持命名键（escape/return/letter 等），不支持组合修饰键（与 Anthropic 保持一致）。
 */
export declare function holdKey(text: string, duration: number): Promise<HoldKeyResult>;
/**
 * 等待指定秒数。纯 setTimeout 包装，用于给 UI 动画留出时间。
 */
export declare function wait(duration: number): Promise<WaitResult>;
/**
 * 滚动。
 *
 * 历史实现用 `cliclick w:dx,dy` 模拟滚轮 —— **这是错的**：
 *   cliclick 的 `w:` 命令含义是 "wait <ms>"，不是滚轮。它会把 `0,3` 当作非法毫秒
 *   静默吞掉，结果就是滚不动。cliclick 在 5.x 版本之前根本没有滚轮原生命令。
 *
 * 现改用 macOS 自带的 python3 + Quartz 框架调用 CoreGraphics 的
 * `CGEventCreateScrollWheelEvent`，这是 macOS 原生滚轮事件，最贴近真实硬件行为，
 * 且 macOS 默认就装了 python3 与 Quartz（PyObjC），无需额外依赖。
 *
 * 坐标语义：模型给的是截图坐标，先 rescaleToLogical 还原为逻辑像素再用。
 *
 * 滚动方向约定（与 Anthropic computer_20250124 一致）：
 *   - up    : 内容向上 = 滚轮向下推（dy 为负）  ← 注意符号
 *   - down  : 内容向下 = 滚轮向上推（dy 为正）
 *   - left/right 同理对水平轴
 *
 * 但 macOS CGEventCreateScrollWheelEvent 的符号约定是：
 *   - vertical 正值 = 内容向上（即 "scroll up" 视觉效果）
 *   - horizontal 正值 = 内容向左
 * 所以语义直接映射即可，不需要再翻转。
 */
export declare function scrollAt(x: number, y: number, scroll_direction: ScrollDirection, scroll_amount: number): Promise<ScrollResult>;
/**
 * 查询鼠标当前坐标。优先 cliclick p（返回 "x,y"），fallback 到 AppleScript。
 */
export declare function getCursorPosition(): Promise<CursorPositionResult>;
