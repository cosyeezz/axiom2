import { type Session } from '../../vendor/cbc-core/node/index.js';
import { type AgentInputItem } from '../../vendor/cbc-shared/node/index.js';
import type { Logger } from '@genie/telemetry';
import { type TeamConfig } from './team-protocol';
import { type TeamRuntimeManifest } from './team-runtime-manifest';
export interface TeamRuntimeAdoption {
    manifest: TeamRuntimeManifest;
    config: TeamConfig;
    adoptedMembers: string[];
    unresumableMembers: string[];
}
export declare function adoptTeamRuntimeForSession(session: Session, logger?: Logger): Promise<TeamRuntimeAdoption | undefined>;
export declare function buildTeamRuntimeResumeInput(session: Session, adoption?: TeamRuntimeAdoption, logger?: Logger): AgentInputItem | undefined;
