import { ENABLE_LINUX_SANDBOX_CLI } from '@genie/product';
export { ENABLE_LINUX_SANDBOX_CLI };
/** Linux 仅在有效开关为 `1` 时启用 sandbox-cli。新名字未设置时，旧名字同样生效。 */
export declare function isLinuxSandboxCLIEnabled(): boolean;
/** sandbox-cli 是否在当前 host 受支持。 */
export declare function isSandboxCLIPlatformSupported(): boolean;
