import { Session } from '../../vendor/cbc-core/node/index.js';
import { Logger } from '@genie/telemetry';
export declare const PlanStorageService: unique symbol;
/**
 * Interface for Plan content persistence
 */
export interface PlanStorageService {
    /**
     * Initialize plan file path for a session
     * Generates a unique plan file path and stores it in session.meta.planFilePath
     * @param session The session
     * @returns The generated plan file path
     */
    initializePlanFilePath(session: Session): string;
    /**
     * Get plan file path from session
     * @param session The session
     * @returns The plan file path or undefined if not initialized
     */
    getPlanFilePath(session: Session): string | undefined;
    /**
     * Write plan content to file
     * @param session The session
     * @param content The plan content to write
     */
    write(session: Session, content: string): Promise<void>;
    /**
     * Read plan content from file
     * @param session The session
     * @returns The plan content or undefined if not found
     */
    read(session: Session): Promise<string | undefined>;
    /**
     * Read plan content from file
     * @param session The session
     * @returns The plan content or undefined if not found
     */
    syncRead(session: Session): string | undefined;
    /**
     * Check if plan file exists
     * @param session The session
     */
    exists(session: Session): Promise<boolean>;
}
export declare class PlanStorageServiceImpl implements PlanStorageService {
    protected readonly logger: Logger;
    /**
     * Initialize plan file path for a session
     */
    initializePlanFilePath(session: Session): string;
    /**
     * Get plan file path from session
     */
    getPlanFilePath(session: Session): string | undefined;
    /**
     * Write plan content to file
     */
    write(session: Session, content: string): Promise<void>;
    /**
     * Read plan content from file
     */
    read(session: Session): Promise<string | undefined>;
    syncRead(session: Session): string | undefined;
    /**
     * Check if plan file exists
     */
    exists(session: Session): Promise<boolean>;
}
