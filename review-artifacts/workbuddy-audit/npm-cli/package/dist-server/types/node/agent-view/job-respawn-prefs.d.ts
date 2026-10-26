/**
 * 子智能体运行时切模型 / 权限后，写回 job.respawnArgs。
 *
 * 重启回放的是建号时的 flag。只改内存 override 会让工人重启后回到创建时那档，
 * 因此这里同时更新 job.respawnArgs 与 Agent Home 档案。设置页是主对话的全局默认，
 * 子智能体切换不能回写它。
 */
import { type IJobStore } from './agent-view-protocol';
export declare function replaceCliFlag(args: readonly string[], flag: string, value?: string): string[];
/** 当前进程是子智能体工人：配置只记在自己的 job / 档案上，不写宿主 settings.json。 */
export declare function shouldSyncHostCliModel(): boolean;
export declare function persistJobRespawnFlag(store: IJobStore, jobId: string, flag: string, value: string): Promise<boolean>;
export declare function persistJobRespawnModel(modelId: string, store?: IJobStore): Promise<boolean>;
export declare function persistJobRespawnPermissionMode(modeId: string, store?: IJobStore): Promise<boolean>;
