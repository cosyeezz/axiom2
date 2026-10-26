import type { ReadSessionCatalogOptions, SessionCatalog } from './types';
/** Read available commands and skills without admitting a query or persisting a session. */
export declare function readSessionCatalog(options?: ReadSessionCatalogOptions): Promise<SessionCatalog>;
