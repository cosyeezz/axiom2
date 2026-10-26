import { randomUUID } from "node:crypto";
import { managedChildren, managedDirectory, removeManagedDirectory } from "./managed-removal.js";
import { atomicRtkJson, readRtkConfig, rtkConfigPath, rtkDirectoryPattern } from "./rtk-config.js";
const parents = ["integrations", "rtk", "versions"];
/** Shared by the online service and the desktop's independent maintenance host. */
export function rtkRemovalDirectories(root, config) {
    const directories = [...new Set([...managedChildren(root, parents.slice(0, -1), "versions", rtkDirectoryPattern), ...(config.removalPending ?? []), ...(config.installation ? [config.installation.directory] : [])])].sort();
    for (const directory of directories)
        managedDirectory(root, parents, directory, rtkDirectoryPattern);
    return directories;
}
export function removeRtk(root, revision, barrier, phase = () => { }) {
    barrier();
    const fresh = readRtkConfig(root);
    if (fresh.revision !== revision)
        throw Error("配置已变化，请重新确认卸载。");
    const directories = rtkRemovalDirectories(root, fresh);
    phase("removing");
    const next = { ...fresh, revision: randomUUID(), installation: undefined, removalPending: directories };
    atomicRtkJson(rtkConfigPath(root), next);
    try {
        for (const directory of directories)
            removeManagedDirectory(root, parents, directory, rtkDirectoryPattern);
    }
    catch {
        throw Error("RTK 已停用，部分程序文件未能删除；请解除文件占用后重试清理。设置和效果记录已保留。");
    }
    phase("validating");
    // Re-enumerate before clearing the recovery record; unexpected versions stay visible.
    if (rtkRemovalDirectories(root, { ...next, removalPending: undefined }).length)
        throw Error("仍有 RTK 程序文件，清理尚未完成；请重新核实。");
    atomicRtkJson(rtkConfigPath(root), { ...next, removalPending: undefined });
}
//# sourceMappingURL=rtk-removal.js.map