/**
 * Visual Regression Testing Helpers
 * Provides utilities for screenshot capture, comparison, and visual validation
 */
import { Page } from '@playwright/test';
export interface ScreenshotOptions {
    fullPage?: boolean;
    clip?: {
        x: number;
        y: number;
        width: number;
        height: number;
    };
    mask?: Array<{
        selector: string;
        color?: string;
    }>;
    animations?: 'disabled' | 'allow';
    caret?: 'hide' | 'initial';
}
export interface ComparisonResult {
    pixelDifference: number;
    percentageDifference: number;
    width: number;
    height: number;
    diffImagePath?: string;
    passed: boolean;
    threshold: number;
}
export interface VisualTest {
    name: string;
    baseline: string;
    current: string;
    diff?: string;
    result: ComparisonResult;
    timestamp: string;
}
export declare class VisualRegressionHelpers {
    private screenshotDir;
    private baselineDir;
    private diffDir;
    private threshold;
    constructor(screenshotDir: string, threshold?: number);
    /**
     * Ensure screenshot directories exist
     */
    private ensureDirectories;
    /**
     * Capture a screenshot with advanced options
     */
    captureScreenshot(page: Page, name: string, options?: ScreenshotOptions): Promise<string>;
    /**
     * Capture baseline screenshot
     */
    captureBaseline(page: Page, name: string, options?: ScreenshotOptions): Promise<string>;
    /**
     * Capture comparison screenshot
     */
    captureComparison(page: Page, name: string, options?: ScreenshotOptions): Promise<string>;
    /**
     * Capture workflow screenshot with metadata
     */
    captureWorkflowScreenshot(page: Page, workflowName: string, step?: string): Promise<string>;
    /**
     * Compare two screenshots
     */
    compareScreenshots(baselinePath: string, currentPath: string, threshold?: number): Promise<ComparisonResult>;
    /**
     * Run visual regression test
     */
    runVisualTest(page: Page, testName: string, options?: ScreenshotOptions & {
        threshold?: number;
    }): Promise<VisualTest>;
    /**
     * Generate visual test report
     */
    generateVisualReport(tests: VisualTest[]): Promise<string>;
    /**
     * Generate HTML visual report
     */
    private generateHtmlReport;
    /**
     * Clean up old screenshots
     */
    cleanupOldScreenshots(daysOld?: number): Promise<void>;
    /**
     * Set default threshold for comparisons
     */
    setThreshold(threshold: number): void;
    /**
     * Get current threshold
     */
    getThreshold(): number;
}
