export declare const TerminalTitleUpdater: unique symbol;
export interface TitleAnalysisResult {
    isNewTopic: boolean;
    title: string | null;
}
export interface TerminalTitleUpdater {
    /**
     * Analyze user message and update terminal title if it indicates a new topic
     * @param userMessage The user's message to analyze
     * @param session Optional session to save topic to history
     */
    analyzeAndUpdate(userMessage: string, session?: any): Promise<void>;
    /**
     * Directly update the terminal title
     * @param title The title to set
     */
    update(title: string): void;
    /**
     * Save topic to session history
     * @param session The session to save to
     * @param topic The topic to save
     */
    saveTopic(session: any, topic: string): Promise<void>;
    /**
     * Set force enabled (for non-interactive mode with parameter)
     */
    setForceEnabled(enabled: boolean): void;
    /**
     * Check if terminal title updates are disabled
     */
    get disabled(): boolean;
    /**
     * Get the pending topic generation promise for a session
     * Used by stream-json-view to wait for topic before closing connection
     * @param sessionId The session ID to get pending promise for
     * @returns The pending promise or undefined if no pending topic generation
     */
    getPendingTopicPromise(sessionId: string): Promise<void> | undefined;
}
