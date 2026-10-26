import { InsightsReportService } from './insights-protocol';
export declare class InsightsReportServiceImpl implements InsightsReportService {
    generateReport(insightsData: Record<string, unknown>, language?: string): Promise<string>;
    private buildHtml;
    private esc;
    /** Escape HTML then render basic markdown: **bold**, \n\n → paragraphs, \n → <br> */
    private md;
    private buildProjectAreas;
    private buildBarChart;
    private buildModelChart;
    private buildBigWins;
    private buildFrictionCategories;
    private buildCodebuddyMdSection;
    private buildFeatureCards;
    private buildPatternCards;
    private buildHorizonCards;
}
