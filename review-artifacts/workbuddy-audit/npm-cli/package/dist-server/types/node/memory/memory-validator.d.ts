import { Logger } from '@genie/telemetry';
import { Memory, MemoryValidateOptions, MemoryValidator } from './memory-protocol';
export declare class MemoryValidatorImpl implements MemoryValidator {
    protected readonly logger: Logger;
    validate(memory: Memory, options?: MemoryValidateOptions): boolean;
}
