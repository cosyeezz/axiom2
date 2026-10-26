import type { ConfigChange, NotifyConfigChangeOptions } from './types';
/** Notify a committed host write. No query admission, session registration or transcript is created. */
export declare function notifyConfigChange(change: ConfigChange, options?: NotifyConfigChangeOptions): Promise<void>;
