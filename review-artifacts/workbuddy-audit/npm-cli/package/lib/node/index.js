/**
 * TUI mode entry point — full module set.
 *
 * Re-exports all shared modules from index-shared.ts, then adds TUI-only modules.
 * The shared file is the DEFAULT place to add new modules.
 * Only add exports here if the module has hard TUI dependencies
 * (e.g., imports from ./ui, ink, react, TUI panels).
 *
 * See also: index-headless.ts (headless/SDK entry point)
 */
import './cli/tui-flags';
import './process-install';
export * from './index-shared';
// ── TUI-only modules ─────────────────────────────────────────────────
// These modules are excluded from headless builds because they depend on
// TUI rendering (ink/react), heavy optional deps, or interactive-only features.
// Agent View 的数据层在 index-shared 里（headless 也要写 job 状态），
// 只有这个策略依赖 CliView / Ink，所以单独在 TUI 入口注册。
export * from './cli/strategies/agents-mode-strategy';
export * from './doctor'; // CLI diagnostics wizard
export * from './install'; // CLI install / shell-setup
export * from './navigation'; // TUI page routing
export * from './remote-control'; // Remote control via WeChat etc.
export * from './resume'; // ResumeMiddleware (imports TUI panel)
export * from './sandbox-legacy'; // legacy e2b sandbox (heavy deps ~1250 modules)
export * from './shortcut'; // TUI keyboard shortcuts
export * from './tips'; // TUI tips / user state tracking
export * from '@genie/cbc-tui'; // TUI UI components (React + Ink)，已拆到 @genie/cbc-tui
export * from './feedback-survey'; // TUI feedback survey
export * from './undo-redo'; // TUI undo/redo
export * from './prompt-suggestion'; // TUI prompt suggestions
//# sourceMappingURL=index.js.map