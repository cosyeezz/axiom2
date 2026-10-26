import { AuthenticationStartupGate } from '@genie/authentication';
export declare class AgentAuthenticationStartupGate implements AuthenticationStartupGate {
    wait(): Promise<void>;
}
