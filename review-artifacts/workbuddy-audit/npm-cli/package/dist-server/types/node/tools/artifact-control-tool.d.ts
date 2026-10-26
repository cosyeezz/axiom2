import { AuthenticationManager } from '@genie/authentication';
import { Session } from '../../vendor/cbc-core/node/index.js';
import { Agent, ToolNames } from '../../vendor/cbc-shared/node/index.js';
import { AbTestService, ProductManager } from '@genie/product';
import { Logger } from '@genie/telemetry';
import type { RunContext } from '@openai/agents';
import { z } from 'zod';
import { BaseTool } from './base-tool';
import { Tool, ToolCallArgumentRenderer, ToolResult } from './tool-protocol';
/**
 * ArtifactControl 工具参数：对一个已发布的 artifact 执行控制动作。
 *
 * 当前**唯一**支持的动作是「取消发布」（unpublish）：把此前用 Artifact 工具发布的
 * HTML 页面 / Markdown 文档的公开链接设为私密（撤销公开访问）。
 *
 * 二选一（至少一个）：
 *   - shareLink：Artifact 返回的完整链接（形如 .../p/{nodeId}），工具会自行解析出 nodeId。
 *   - nodeId：链接末段的裸标识（等价于后端取消发布接口所需的 fileId）。
 */
declare const ArtifactControlParameters: z.ZodObject<{
    shareLink: z.ZodOptional<z.ZodString>;
    nodeId: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    nodeId?: string | undefined;
    shareLink?: string | undefined;
}, {
    nodeId?: string | undefined;
    shareLink?: string | undefined;
}>;
/**
 * ArtifactControl 工具 —— 已发布 artifact 的控制入口（issue #81031 更名自 ShareLinkUnpublish）。
 *
 * 当前**唯一**能力：取消发布（unpublish）——把一个 Artifact 工具发布的
 * HTML 页面 / Markdown 文档的公开分享链接设为私密（互联网不可访问，并尽量移除协作人）。
 * 尚不支持列表 / 删除 / 权限调整等其他动作；命名仅为后续以可选参数扩展预留空间。
 *
 * 与 ArtifactTool 对称：同样仅面向国内 / iOA / 内部 endpoint，复用 CBC 自身会话的
 * access token。按链接形态路由（见 classifyShareLink / revoke）：
 *   - html 页面节点（/p/）→ `POST /space/api/view/page/unpublish`（body `{ fileId }`）；
 *   - markdown 文档节点（/space/d/）→ `POST /space/api/permission/set-permission`
 *     设为 `{ role: 'invalid' }`（doc 节点没有 page/unpublish，硬调会报 "page meta not found"）；
 *   - 裸 nodeId（无法判型）→ 先试 page/unpublish，任意失败回退 set-permission(invalid)。
 *
 * 用户可以直接把 Artifact 返回的链接贴回来撤销，无需记忆内部标识，也无需依赖会话状态——
 * nodeId 稳定内嵌在链接中（见 spaceengine urlgen.PublishURL）。
 */
export declare class ArtifactControlTool extends BaseTool implements Tool {
    protected readonly authManager: AuthenticationManager;
    protected readonly productManager: ProductManager;
    protected readonly abTestService?: AbTestService;
    protected readonly logger: Logger;
    name: ToolNames;
    aliases: string[];
    description: string;
    parameters: z.ZodObject<{
        shareLink: z.ZodOptional<z.ZodString>;
        nodeId: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        nodeId?: string | undefined;
        shareLink?: string | undefined;
    }, {
        nodeId?: string | undefined;
        shareLink?: string | undefined;
    }>;
    strict: boolean;
    argumentRenderer: ToolCallArgumentRenderer;
    isEnabled: (_args: {
        runContext: RunContext<Session>;
        agent: Agent;
    }) => Promise<boolean>;
    execute(input: z.infer<typeof ArtifactControlParameters>, _context: RunContext<Session>): Promise<ToolResult>;
    /**
     * 按节点类型取消公开访问，返回成功走的是哪条路径（page / permission）。
     *
     * - `page`：仅 page/unpublish。
     * - `doc`：仅 makeDocPrivate（关闭公开档位 + 移除所有人类协作人）。
     * - `unknown`：先 page/unpublish，**任意**失败即回退 makeDocPrivate
     *   （不按错误串匹配——串匹配脆弱，且 CLI markdown 分享大多本就是 doc 节点）。
     *   两者都失败时返回权限接口的失败详情（更可能是真实路径），并注明 page 也已尝试。
     */
    private revoke;
    /** page/unpublish（html 页面节点）：body `{ fileId }`，code===0 成功。 */
    private unpublishPage;
    /**
     * 把 markdown doc 节点设为**完全私密**：关闭公开档位 + 移除所有人类协作人。
     *
     * 仅关公开档位（public.role=invalid）只堵住「互联网公开」这道门；此前通过邀请/协作
     * 加入的成员仍能访问。真正的「设为私密」必须连协作人一起撤掉，因此本方法：
     *   1. 先查当前协作人：POST /space/api/permission/collaborators `{ recordId }`
     *      → `{ collaborators: [{ uid, role, type }] }`（type='public' 是公开档位占位条目、
     *      role='owner' 是所有者，二者都要跳过）。查失败不致命——仍继续关公开档位，
     *      只是附警告说明协作人可能未清干净。
     *   2. 一次原子调用 POST /space/api/permission/set-permission
     *      `{ recordId, public:{role:'invalid'}, members:[{uid, role:'invalid'}...] }`
     *      （后端 role='invalid' → permission.None，即移除成员；见 spaceengine
     *      set_permission.go / protocol.go）。code===0 成功。
     *
     * 这是 ArtifactTool 上传时 set-permission(reader) 的逆操作，但覆盖面更全（含协作人）。
     * agent override 条目（响应里的 agents）不在此处理：CLI 分享链路不会产生它们。
     */
    private makeDocPrivate;
}
export {};
