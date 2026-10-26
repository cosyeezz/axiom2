import type { AgentInputItem } from '../../vendor/cbc-shared/node/index.js';
import { type ImageBlobIdentity } from './blob-store-protocol';
/** Readers resolve verified original bytes by identity, never by a persisted path. */
export type PersistedImageBlobReader = (identity: ImageBlobIdentity) => Promise<string | undefined>;
export declare function hasPersistedUserImageBlobRef(item: AgentInputItem): boolean;
/** Hydrate a consumer copy; callers choose the bytes and unavailable-image policy. */
export declare function rehydratePersistedUserImagesForReplay(item: AgentInputItem, reader: PersistedImageBlobReader, unavailableImageText?: string): Promise<AgentInputItem>;
