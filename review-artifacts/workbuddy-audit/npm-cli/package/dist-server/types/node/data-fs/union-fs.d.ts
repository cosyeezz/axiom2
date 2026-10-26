/**
 * UnionFs（E26，2026-08-23 用户裁决）：把多层 DataFs 合成一个，逐路径
 * 回落——取代此前"整层择一"的遮蔽语义。命名从经典 UnionFS（多分支优先级
 * 读穿并集），与 just-bash Fs 家族短名同风格；**刻意避开 Overlay 名**——
 * just-bash 的 OverlayFs 是"真实目录+内存 COW"沙箱件，语义完全不同。
 * served 链条固定为 `query.fs → start.fs → 进程内存`：pod 磁盘只在宿主
 * start.fs 有意路由的路径可达，其余一律被内存底吸收（零泄漏出厂保证）。
 *
 * 语义（node errno 契约）：
 * - 读族（readFile/stat/access）：自上而下，首个非 ENOENT/ENOTDIR 层胜出；
 *   该层的其他错误（EISDIR 等）原样上抛；全层缺席 → 首层的缺席错误。
 * - readdir：跨层并集（上层同名 dirent 优先），有层响应即成功；全层缺席 → ENOENT。
 * - 写族（writeFile/mkdir）：自上而下探"接纳"——层抛 ENOENT/ENOTDIR 即视为
 *   "路径不在其覆盖面"（Mountable 未挂载路径、父目录不存在皆此类）让位下层；
 *   其他错误原样上抛。每层覆盖面由其实现自决：全量 fs 全 claim、Mountable
 *   只 claim 挂载面、内存底 claim 一切（mkdir recursive 恒成功）。
 * - 变更族（rm/unlink/rename）：定位到**首个持有该路径的层**并只在该层操作
 *   （不做跨层 whiteout——上层删除即透出下层同名项，属文档化边界）；rename
 *   限同层，目标父目录不在该层则按该层错误上抛；rm force 全层缺席静默成功。
 */
import { type DataFs } from './index';
export declare function unionFs(layersIn: ReadonlyArray<DataFs | undefined>): DataFs;
