export const reloadScope = (scope) => `reload:${scope.workspaceId}:${scope.sessionId}`;
export const resourceKinds = ["skills", "extensions", "prompts", "themes", "instructions", "tools", "settings"];
export const resourceLabels = { skills: "Skills", extensions: "扩展", prompts: "提示词模板", themes: "主题", instructions: "项目指令", tools: "可用工具", settings: "会话配置" };
export function resourceChanges(before, after) {
    if (!before)
        return { added: [], removed: [], changed: [], unknown: true };
    const old = new Map(before.map(item => [item.name, item.revision]));
    const next = new Map(after.map(item => [item.name, item.revision]));
    return {
        added: after.filter(item => !old.has(item.name)).map(item => item.name),
        removed: before.filter(item => !next.has(item.name)).map(item => item.name),
        changed: after.filter(item => old.has(item.name) && old.get(item.name) !== item.revision).map(item => item.name),
        unknown: false,
    };
}
//# sourceMappingURL=reload.js.map