/**
 * API v1 — Memory (个性化记忆)
 *
 * 将 agent-cli 内部的 MemoryManager 功能暴露为 REST API
 * 供 WorkBuddy Desktop 和其他客户端调用
 *
 * 公开 REST API 端点：
 *   - GET    /api/v1/memory/profile        → 获取记忆档案
 *   - PUT    /api/v1/memory/profile        → 保存记忆设置
 *   - POST   /api/v1/memory/suggestion     → 提交修改建议
 *   - POST   /api/v1/memory/import         → 导入新内容
 *   - GET    /api/v1/memory/status         → 检查更新状态
 */
export declare class MemoryController {
    private readonly memoryManager;
    private readonly logger;
    /**
     * GET /api/v1/memory/profile → 获取记忆档案
     *
     * 返回当前用户的完整记忆内容和配置状态
     */
    getMemoryProfile(): Promise<void>;
    /**
     * PUT /api/v1/memory/profile → 保存记忆设置
     *
     * 请求体: { generateMemoryEnabled: boolean }
     * 响应: { success: boolean, generateMemoryEnabled: boolean }
     */
    saveMemorySettings(body: {
        generateMemoryEnabled?: boolean;
    }): Promise<void>;
    /**
     * POST /api/v1/memory/suggestion → 提交修改建议
     *
     * 请求体: { suggestion: string, currentMemory?: string }
     * 响应: { success: boolean, accepted: boolean, error?: string }
     *
     * 当用户在"管理记忆"弹窗中修改记忆后，通过此接口提交
     */
    submitMemorySuggestion(body: {
        suggestion?: string;
        currentMemory?: string;
    }): Promise<void>;
    /**
     * POST /api/v1/memory/import → 导入新内容
     *
     * 请求体: { content: string }
     * 响应: { success: boolean, imported: boolean, error?: string }
     *
     * 当用户在"导入记忆"弹窗中粘贴内容后，通过此接口导入
     */
    importMemoryContent(body: {
        content?: string;
    }): Promise<void>;
    /**
     * GET /api/v1/memory/status → 检查更新状态
     *
     * 检查后台是否正在更新/生成新的记忆（Phase 6 M5 功能）
     * 响应: { isUpdating: boolean, error?: string }
     */
    checkMemoryUpdating(): Promise<void>;
}
