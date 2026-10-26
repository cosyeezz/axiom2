import { openCliSkillNames } from "./integrations/opencli-runtime.js";
import { reaSkillName } from "./integrations/rea-runtime.js";
/** Resource names are unique within each effective Skill/MCP catalog. */
export function builtinCapability(kind, name) {
    if (kind === "mcp")
        return name === "rea" ? "rea" : undefined;
    if (name === reaSkillName)
        return "rea";
    return openCliSkillNames.includes(name) ? "opencli" : undefined;
}
/** A missing built-in does not mask a readable general resource of the same name. */
export function resolveBuiltinSkills(general, builtin) {
    const byName = new Map();
    for (const skill of [...builtin, ...general])
        if (!byName.has(skill.name))
            byName.set(skill.name, skill);
    return [...byName.values()];
}
//# sourceMappingURL=builtin-capabilities.js.map