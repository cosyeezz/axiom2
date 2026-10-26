import { realpath, stat } from "node:fs/promises";
import { dirname } from "node:path";
import { AppError, object, text } from "../shared/protocol.js";
import { openMemoryFile } from "./memory-open.js";
/** Resolve only discovered identities; the client never chooses an arbitrary OS path. */
export class SkillFiles {
    capabilities;
    reveal;
    edit;
    opening = false;
    constructor(capabilities, reveal, edit = openMemoryFile) {
        this.capabilities = capabilities;
        this.reveal = reveal;
        this.edit = edit;
    }
    async command(c, signal) {
        const scope = { workspaceId: text(c.workspaceId, "工作空间"), sessionId: text(c.sessionId, "会话") };
        this.capabilities.store.session(scope.workspaceId, scope.sessionId);
        const p = object(c.params);
        if (Object.keys(p).some(key => key !== "id") || !["capabilities.skill.open", "capabilities.skill.reveal"].includes(c.op))
            throw new AppError("INVALID_INPUT", "技能文件操作无效");
        const id = text(p.id, "技能标识");
        return this.capabilities.store.external(c, async () => {
            if (this.opening)
                throw new AppError("LIMIT", "正在打开技能文件，请稍候");
            this.opening = true;
            try {
                const catalog = await this.capabilities.get(scope);
                const item = catalog.skills.find(item => item.id === id && item.available);
                if (!item)
                    throw new AppError("CAPABILITY_UNAVAILABLE", "技能已不存在或不可读取，请刷新技能列表");
                const path = await realpath(item.source), identity = await stat(path);
                if (!identity.isFile() || !/\.md$/i.test(path))
                    throw new AppError("SKILL_FILE", "只能打开已发现的 Markdown 技能文件");
                this.capabilities.store.session(scope.workspaceId, scope.sessionId);
                signal.throwIfAborted();
                if (c.op === "capabilities.skill.open")
                    await this.edit(path, signal);
                else
                    await this.reveal(dirname(path), signal);
                return { requested: true };
            }
            catch (error) {
                if (error instanceof AppError)
                    throw error;
                throw new AppError("SKILL_OPEN_FAILED", "无法打开技能文件或所在目录，请检查文件权限与本机桌面环境");
            }
            finally {
                this.opening = false;
            }
        });
    }
}
//# sourceMappingURL=skill-files.js.map