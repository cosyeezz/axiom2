/**
 * Utility functions for Plan Mode
 */
export declare abstract class PlanModeUtils {
    /**
     * Generate a unique plan file name in the format: {adjective}-{noun}-{scientist}-{opaqueSuffix}.md
     */
    static generateUniquePlanFileName(): string;
    private static generateOpaqueSuffix;
    /**
     * Generate a unique plan file path
     * @returns Absolute path to the plan file in ~/.codebuddy/plans/
     */
    static generatePlanFilePath(): string;
}
