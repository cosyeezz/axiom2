import { Logger } from '@celljs/core';
import { ExternalUriOpener } from '@genie/runtime';
import { Subject } from 'rxjs';
export declare class CliExternalUriOpener implements ExternalUriOpener {
    urlSubject: Subject<string>;
    protected readonly logger: Logger;
    open(uri: string): Promise<boolean>;
}
