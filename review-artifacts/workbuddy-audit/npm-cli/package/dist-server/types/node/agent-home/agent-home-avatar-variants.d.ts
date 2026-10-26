/**
 * 头像 0 专供分身（主智能体）；普通智能体可选 1..COUNT-1。
 * 1..15 是几何款（6 号是包子），16..20 是中国元素（灯笼、祥云、印章、熊猫、葫芦），
 * 21 方块风，22 邪恶南瓜，23 胖五角星，24 呆萌蛤蟆。
 * 配色只用 Google 四色；分身的专属是「黄色三角 + 星芒」，不是黄色本身。
 */
export declare const AGENT_HOME_AVATAR_VARIANT_COUNT = 25;
/**
 * 没存 avatarVariant 的旧档案按 id 哈希兜底：哈希区间固定在最初的 1..15，
 * 新增款式不会让这些人「换脸」。
 */
export declare const AGENT_HOME_LEGACY_AVATAR_VARIANT_COUNT = 16;
export interface AgentHomeAvatarIdentity {
    id: string;
    avatarVariant?: number;
}
export declare function hashAgentHomeAvatarSeed(seed: string): number;
export declare function normalizeAgentHomeAvatarVariant(value: unknown): number | undefined;
export declare function fallbackAgentHomeAvatarVariant(seed: string): number;
export declare function resolveAgentHomeAvatarVariant(identity: AgentHomeAvatarIdentity): number;
/**
 * 新建时在当前使用最少的头像里随机挑一款：每次新建都换一张脸，同时在所有款式用完前不重复。
 */
export declare function pickAgentHomeAvatarVariant(existing: readonly AgentHomeAvatarIdentity[], random?: () => number): number;
/** 组队最多 6 人；在全部普通头像内线性探测，确保同屏成员优先互不重复。 */
export declare function resolveDistinctAgentHomeAvatarVariants(identities: readonly AgentHomeAvatarIdentity[]): Map<string, number>;
