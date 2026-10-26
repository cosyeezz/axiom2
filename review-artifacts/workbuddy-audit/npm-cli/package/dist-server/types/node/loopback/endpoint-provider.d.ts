import { Deferred } from '@celljs/core';
import { ServerAware } from '@celljs/web/lib/node';
import { Server } from 'http';
import { EndpointProvider } from './server-protocol';
export declare class EndpointProviderImpl implements EndpointProvider, ServerAware {
    protected endpointDeferred: Deferred<string>;
    protected listenFailedDeferred: Deferred<Error>;
    get(): Promise<string>;
    whenListenFailed(): Promise<Error>;
    setServer(server: Server): Promise<void>;
    protected resolveEndpoint(server: Server): Promise<void>;
}
