/**
 * @genie/cbc-plugins — CodeBuddy Code 插件系统运行时。
 *
 * 目录布局镜像 agent-cli：`src/node/plugins/**` 与拆分前保持一致，git 历史通过 `git mv` 继承。
 * agent-cli 侧 `src/node/plugins/index.ts` 已删除，原先所有 `../plugins/xxx` 相对 import
 * 改指向 `@genie/cbc-plugins` 主入口；主 barrel 通过 `export * from '@genie/cbc-plugins'`
 * 反向消费本入口（`packages/agent-cli/src/node/index-shared.ts`）。
 *
 * 与 `@genie/agent-cli` 之间允许循环依赖：plugins 内 loader / installer / marketplace 等实现
 * 通过 `import { X } from '@genie/agent-cli/node/<子路径>/<leaf>'` 拿到 agent-cli 源码 live binding；
 * 运行时安全前提是本包顶层无立即消费 agent-cli 运行时值的语句（Symbol 值走 `-protocol.ts` 叶子文件；
 * 见 `.codebuddy/commands/cli/split-package.md` 铁律 4）。
 */
export * from './plugins/plugin-protocol';
export * from './plugins';
/**
 * Function Hooks / Claude Mods 运行时（`src/node/mods/**`）。
 *
 * 与 `plugins/**` 的分工：`plugins` 管「插件从哪来、怎么装、怎么发现」
 * （marketplace / installer / loader / MCPB）；`mods` 管「装上之后怎么参与
 * 引擎执行」—— tier 化的 middleware 引擎、`$` capability surface、
 * `engine.create` fold、以及从 `.codebuddy-plugin` / `.claude-plugin` +
 * `hooks/hooks.json` 真实加载一个 mod 目录（等价 `--plugin-dir`）。
 *
 * **走命名空间导出**：mods 沿用上游 claude-code 的类型命名（`Hook` / `Settings` /
 * `On` / `DispatchOptions` 等），这些通用名与 agent-cli 既有导出会撞；用
 * `Mods.*` 收口既保住「与官方等价」的命名，又不污染顶层 barrel。
 *
 * ```ts
 * import { Mods } from '@genie/cbc-plugins';
 * const result = await Mods.bootstrapModsFromPluginDirs({ core });
 * ```
 *
 * 对齐依据见 `src/node/mods/API-ALIGNMENT.md`。
 */
export * as Mods from './mods';
//# sourceMappingURL=index.d.ts.map