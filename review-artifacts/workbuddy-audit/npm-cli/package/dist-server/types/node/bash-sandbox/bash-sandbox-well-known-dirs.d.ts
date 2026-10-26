/**
 * 沙箱规则里当前 CLI 相关的目录短名。
 *
 * @property userDir 用户级配置目录短名（对应 `~/${userDir}/`），官方版为 `.codebuddy`。
 * @property projectDir 项目级配置目录短名（对应工作目录下的 `${projectDir}/`），官方版为 `.codebuddy`。
 */
export interface SandboxCliDirNames {
    readonly userDir: string;
    readonly projectDir: string;
}
/**
 * 派生当前进程沙箱规则应使用的目录短名。
 *
 * 官方版返回 `.codebuddy` / `.codebuddy`；定制版按 `customization.json`
 * 的 `configDir.userDirName` / `configDir.projectDirName` 派生，未配置则回落官方默认。
 *
 * 结果不缓存：这个函数本身是常量时间的属性读取，且 snapshot 已是 process 级冻结值，
 * 缓存反而会给消费方（构造规则模板时按需调用）带来测试隔离难度。
 */
export declare function getSandboxCliDirNames(): SandboxCliDirNames;
