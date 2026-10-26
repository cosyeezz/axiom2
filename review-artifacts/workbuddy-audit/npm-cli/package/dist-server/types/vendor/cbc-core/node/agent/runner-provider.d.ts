import { Runner } from '../../../cbc-shared/node/index.js';
import { RunnerFactory, RunnerProvider } from './agent-protocol';
export declare class RunnerProviderImpl implements RunnerProvider {
    protected readonly runnerFactory: RunnerFactory;
    protected runner: Runner;
    get(): Promise<Runner>;
}
//# sourceMappingURL=runner-provider.d.ts.map