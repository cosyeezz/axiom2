// @tencent-ai/agent-cli/server — ESM entry：server.cjs（惰性 facade + 进程
// 全局封印权威层）的具名再导出，单实现不复刻。createRequire 是刻意的：
// subscribe 等动词为同步签名，惰性装载必须走同步 require。
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const surface = require('./server.cjs');

export const start = surface.start;
export const hasSessionWork = surface.hasSessionWork;
export const notifyConfigChange = surface.notifyConfigChange;
export const readSession = surface.readSession;
export const readSessionCatalog = surface.readSessionCatalog;
export const reload = surface.reload;
export const setSecurityReviewConfig = surface.setSecurityReviewConfig;
export const createSession = surface.createSession;
export const query = surface.query;
export const recover = surface.recover;
export const steer = surface.steer;
export const rewind = surface.rewind;
export const interrupt = surface.interrupt;
export const cancelBackgroundTask = surface.cancelBackgroundTask;
export const listBackgroundTasks = surface.listBackgroundTasks;
export const getBackgroundTask = surface.getBackgroundTask;
export const cancelTask = surface.cancelTask;
export const subscribe = surface.subscribe;
export const close = surface.close;
export const sandboxFromDriver = surface.sandboxFromDriver;
export const bash = surface.bash;
export const local = surface.local;
export const InMemorySessionStore = surface.InMemorySessionStore;
export const WORKBUDDY_TOOLS = surface.WORKBUDDY_TOOLS;
export const tool = surface.tool;
export const createSdkMcpServer = surface.createSdkMcpServer;
export const partitionToolsOption = surface.partitionToolsOption;
export const MountableFs = surface.MountableFs;
export const InMemoryFs = surface.InMemoryFs;
export const OverlayFs = surface.OverlayFs;
export const ReadWriteFs = surface.ReadWriteFs;
export const SessionRewindError = surface.SessionRewindError;
export const isSessionRewindError = surface.isSessionRewindError;
export const ToolsOptionError = surface.ToolsOptionError;
export const isToolsOptionError = surface.isToolsOptionError;
export const AgentOptionError = surface.AgentOptionError;
export const isAgentOptionError = surface.isAgentOptionError;

export default surface;
