import { AuthenticationManager } from '@genie/authentication';
import { ProductManager } from '@genie/product';
import { ExternalUriOpener } from '@genie/runtime';
import { BehaviorSubject } from 'rxjs';
import { InstallService } from '../install';
import { Session } from '../../vendor/cbc-core/node/index.js';
import { FeedbackService, FeedbackState } from './feedback-protocol';
export declare class FeedbackServiceImpl implements FeedbackService {
    readonly stateSubject: BehaviorSubject<FeedbackState>;
    protected readonly productManager: ProductManager;
    protected readonly externalUriOpener: ExternalUriOpener;
    protected readonly authenticationManager: AuthenticationManager;
    protected readonly installService: InstallService;
    openFeedbackPage(session: Session): Promise<void>;
    reset(): void;
    protected buildFeedbackUrl(baseUrl: string, session: Session): Promise<string>;
    protected buildFeedbackBody(session: Session): Promise<string>;
    protected getInstallMethod(): Promise<string>;
}
