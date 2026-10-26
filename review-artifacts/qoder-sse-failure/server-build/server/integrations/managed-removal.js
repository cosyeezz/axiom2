import { lstatSync, opendirSync, realpathSync, rmSync } from "node:fs";
import { join } from "node:path";
/** Only a recorded direct child of a fixed private directory can be removed. */
export function managedDirectory(root, parents, name, pattern) {
    if (!pattern.test(name) || name.includes("/") || name.includes("\\") || name === "." || name === "..")
        throw Error("托管安装记录无效，未删除任何文件。");
    let path = realpathSync(root);
    for (const part of [...parents, name]) {
        path = join(path, part);
        try {
            const stat = lstatSync(path);
            if (stat.isSymbolicLink() || !stat.isDirectory())
                throw Error("托管安装目录被替换或不是普通目录，未删除任何文件。");
        }
        catch (error) {
            if (error.code === "ENOENT")
                return undefined;
            throw error;
        }
    }
    return path;
}
export function removeManagedDirectory(root, parents, name, pattern) {
    const directory = managedDirectory(root, parents, name, pattern);
    if (directory)
        rmSync(directory, { recursive: true });
}
export function managedChildren(root, parents, container, pattern) {
    const directory = managedDirectory(root, parents, container, new RegExp(`^${container}$`));
    const names = [];
    if (directory) {
        const entries = opendirSync(directory);
        try {
            let entry, count = 0;
            while ((entry = entries.readSync())) {
                if (++count > 1024)
                    throw Error("托管目录条目超过核实上限，未执行清理。");
                if (pattern.test(entry.name))
                    names.push(entry.name);
            }
        }
        finally {
            entries.closeSync();
        }
    }
    for (const name of names)
        managedDirectory(root, [...parents, container], name, pattern);
    return names;
}
//# sourceMappingURL=managed-removal.js.map