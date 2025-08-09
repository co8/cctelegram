/**
 * Visual Regression Testing Helpers
 * Provides utilities for screenshot capture, comparison, and visual validation
 */

import { Page } from '@playwright/test';
import fs from 'fs-extra';
import path from 'path';
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';

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

export class VisualRegressionHelpers {
  private screenshotDir: string;
  private baselineDir: string;
  private diffDir: string;
  private threshold: number = 0.2; // Default threshold for pixel differences

  constructor(screenshotDir: string, threshold: number = 0.2) {
    this.screenshotDir = screenshotDir;
    this.baselineDir = path.join(screenshotDir, 'baseline');
    this.diffDir = path.join(screenshotDir, 'diff');
    this.threshold = threshold;
    
    this.ensureDirectories();
  }

  /**
   * Ensure screenshot directories exist
   */
  private async ensureDirectories(): Promise<void> {
    await fs.ensureDir(this.screenshotDir);
    await fs.ensureDir(this.baselineDir);
    await fs.ensureDir(this.diffDir);
  }

  /**
   * Capture a screenshot with advanced options
   */
  async captureScreenshot(
    page: Page, 
    name: string, 
    options: ScreenshotOptions = {}
  ): Promise<string> {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `${name}-${timestamp}.png`;
    const filepath = path.join(this.screenshotDir, filename);

    // Apply screenshot options
    const screenshotOptions: any = {
      path: filepath,
      fullPage: options.fullPage || false,
      animations: options.animations || 'disabled',
      caret: options.caret || 'hide'
    };

    if (options.clip) {
      screenshotOptions.clip = options.clip;
    }

    // Mask dynamic elements if specified
    if (options.mask && options.mask.length > 0) {
      for (const mask of options.mask) {
        try {
          const elements = page.locator(mask.selector);
          const count = await elements.count();
          
          for (let i = 0; i < count; i++) {
            await elements.nth(i).evaluate((el, color) => {
              el.style.backgroundColor = color || '#000000';
              el.style.color = 'transparent';
            }, mask.color);
          }
        } catch (error) {
          console.warn(`Failed to mask element ${mask.selector}: ${error.message}`);
        }
      }
    }

    // Wait for any animations to settle
    await page.waitForTimeout(500);

    // Take screenshot
    await page.screenshot(screenshotOptions);

    console.log(`📸 Screenshot captured: ${filename}`);
    return filepath;
  }

  /**
   * Capture baseline screenshot
   */
  async captureBaseline(
    page: Page, 
    name: string, 
    options: ScreenshotOptions = {}
  ): Promise<string> {
    const filename = `${name}.png`;
    const filepath = path.join(this.baselineDir, filename);

    const screenshotOptions: any = {
      path: filepath,
      fullPage: options.fullPage || false,
      animations: 'disabled',
      caret: 'hide'
    };

    if (options.clip) {
      screenshotOptions.clip = options.clip;
    }

    await page.screenshot(screenshotOptions);

    console.log(`📸 Baseline captured: ${filename}`);
    return filepath;
  }

  /**
   * Capture comparison screenshot
   */
  async captureComparison(
    page: Page, 
    name: string, 
    options: ScreenshotOptions = {}
  ): Promise<string> {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `${name}-${timestamp}.png`;
    const filepath = path.join(this.screenshotDir, filename);

    const screenshotOptions: any = {
      path: filepath,
      fullPage: options.fullPage || false,
      animations: 'disabled',
      caret: 'hide'
    };

    if (options.clip) {
      screenshotOptions.clip = options.clip;
    }

    await page.screenshot(screenshotOptions);

    console.log(`📸 Comparison captured: ${filename}`);
    return filepath;
  }

  /**
   * Capture workflow screenshot with metadata
   */
  async captureWorkflowScreenshot(
    page: Page, 
    workflowName: string, 
    step?: string
  ): Promise<string> {
    const stepSuffix = step ? `-${step}` : '';
    const name = `workflow-${workflowName}${stepSuffix}`;
    
    // Add workflow metadata to page for debugging
    await page.evaluate((metadata) => {
      const div = document.createElement('div');
      div.id = 'workflow-metadata';
      div.style.position = 'fixed';
      div.style.top = '10px';
      div.style.right = '10px';
      div.style.background = 'rgba(0,0,0,0.8)';
      div.style.color = 'white';
      div.style.padding = '10px';
      div.style.fontSize = '12px';
      div.style.fontFamily = 'monospace';
      div.style.zIndex = '9999';
      div.innerHTML = `
        <div>Workflow: ${metadata.workflow}</div>
        <div>Step: ${metadata.step || 'N/A'}</div>
        <div>Time: ${metadata.timestamp}</div>
      `;
      document.body.appendChild(div);
    }, {
      workflow: workflowName,
      step: step || 'complete',
      timestamp: new Date().toISOString()
    });

    const screenshot = await this.captureScreenshot(page, name, {
      fullPage: true,
      mask: [
        { selector: '#workflow-metadata' }, // Hide metadata overlay
        { selector: '[data-testid*="timestamp"]' }, // Hide dynamic timestamps
        { selector: '.loading-spinner' } // Hide loading indicators
      ]
    });

    // Remove metadata element
    await page.evaluate(() => {
      const element = document.getElementById('workflow-metadata');
      if (element) {
        element.remove();
      }
    });

    return screenshot;
  }

  /**
   * Compare two screenshots
   */
  async compareScreenshots(
    baselinePath: string, 
    currentPath: string, 
    threshold: number = this.threshold
  ): Promise<ComparisonResult> {
    // Ensure both images exist
    if (!await fs.pathExists(baselinePath)) {
      throw new Error(`Baseline image not found: ${baselinePath}`);
    }
    
    if (!await fs.pathExists(currentPath)) {
      throw new Error(`Current image not found: ${currentPath}`);
    }

    // Read images
    const baselineBuffer = await fs.readFile(baselinePath);
    const currentBuffer = await fs.readFile(currentPath);

    const baseline = PNG.sync.read(baselineBuffer);
    const current = PNG.sync.read(currentBuffer);

    // Ensure images have the same dimensions
    if (baseline.width !== current.width || baseline.height !== current.height) {
      return {
        pixelDifference: Infinity,
        percentageDifference: 100,
        width: Math.max(baseline.width, current.width),
        height: Math.max(baseline.height, current.height),
        passed: false,
        threshold
      };
    }

    // Create diff image
    const { width, height } = baseline;
    const diff = new PNG({ width, height });

    // Compare images
    const pixelDifference = pixelmatch(
      baseline.data,
      current.data,
      diff.data,
      width,
      height,
      {
        threshold,
        includeAA: false,
        alpha: 0.1,
        aaColor: [255, 255, 0], // Yellow for anti-aliasing differences
        diffColor: [255, 0, 255], // Magenta for pixel differences
        diffColorAlt: [0, 255, 255] // Cyan for alternative differences
      }
    );

    const totalPixels = width * height;
    const percentageDifference = (pixelDifference / totalPixels) * 100;

    // Save diff image if there are differences
    let diffImagePath: string | undefined;
    if (pixelDifference > 0) {
      const currentName = path.basename(currentPath, '.png');
      const diffName = `${currentName}-diff.png`;
      diffImagePath = path.join(this.diffDir, diffName);
      
      await fs.writeFile(diffImagePath, PNG.sync.write(diff));
      console.log(`📊 Diff image saved: ${diffName}`);
    }

    const result: ComparisonResult = {
      pixelDifference,
      percentageDifference,
      width,
      height,
      diffImagePath,
      passed: percentageDifference <= threshold,
      threshold
    };

    console.log(`🔍 Visual comparison: ${pixelDifference} pixels different (${percentageDifference.toFixed(2)}%)`);
    return result;
  }

  /**
   * Run visual regression test
   */
  async runVisualTest(
    page: Page,
    testName: string,
    options: ScreenshotOptions & { threshold?: number } = {}
  ): Promise<VisualTest> {
    const timestamp = new Date().toISOString();
    const baselinePath = path.join(this.baselineDir, `${testName}.png`);
    
    // Take current screenshot
    const currentPath = await this.captureComparison(page, testName, options);
    
    let result: ComparisonResult;
    
    // Check if baseline exists
    if (await fs.pathExists(baselinePath)) {
      // Compare with baseline
      result = await this.compareScreenshots(
        baselinePath,
        currentPath,
        options.threshold || this.threshold
      );
    } else {
      // Create new baseline
      await fs.copy(currentPath, baselinePath);
      console.log(`📝 New baseline created: ${testName}.png`);
      
      result = {
        pixelDifference: 0,
        percentageDifference: 0,
        width: 0,
        height: 0,
        passed: true,
        threshold: options.threshold || this.threshold
      };
    }

    return {
      name: testName,
      baseline: baselinePath,
      current: currentPath,
      diff: result.diffImagePath,
      result,
      timestamp
    };
  }

  /**
   * Generate visual test report
   */
  async generateVisualReport(tests: VisualTest[]): Promise<string> {
    const reportData = {
      timestamp: new Date().toISOString(),
      summary: {
        total: tests.length,
        passed: tests.filter(t => t.result.passed).length,
        failed: tests.filter(t => !t.result.passed).length,
        threshold: this.threshold
      },
      tests: tests.map(test => ({
        name: test.name,
        passed: test.result.passed,
        pixelDifference: test.result.pixelDifference,
        percentageDifference: test.result.percentageDifference,
        dimensions: `${test.result.width}x${test.result.height}`,
        baseline: path.relative(this.screenshotDir, test.baseline),
        current: path.relative(this.screenshotDir, test.current),
        diff: test.diff ? path.relative(this.screenshotDir, test.diff) : null,
        timestamp: test.timestamp
      }))
    };

    // Generate JSON report
    const reportPath = path.join(this.screenshotDir, 'visual-test-report.json');
    await fs.writeJSON(reportPath, reportData, { spaces: 2 });

    // Generate HTML report
    const htmlReportPath = await this.generateHtmlReport(reportData);

    console.log(`📊 Visual test report generated: ${reportPath}`);
    console.log(`🌐 HTML report generated: ${htmlReportPath}`);

    return reportPath;
  }

  /**
   * Generate HTML visual report
   */
  private async generateHtmlReport(reportData: any): Promise<string> {
    const htmlContent = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Visual Regression Test Report</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 20px; background: #f5f5f5; }
        .header { background: white; padding: 20px; border-radius: 8px; margin-bottom: 20px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
        .summary { display: flex; gap: 20px; margin-bottom: 20px; }
        .stat { background: white; padding: 15px; border-radius: 8px; text-align: center; min-width: 100px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
        .stat.passed { border-left: 4px solid #4CAF50; }
        .stat.failed { border-left: 4px solid #f44336; }
        .test { background: white; margin-bottom: 20px; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
        .test-header { padding: 15px; background: #f9f9f9; border-bottom: 1px solid #ddd; }
        .test-content { padding: 15px; }
        .test.passed .test-header { background: #e8f5e8; }
        .test.failed .test-header { background: #ffeaea; }
        .images { display: flex; gap: 15px; flex-wrap: wrap; }
        .image-container { flex: 1; min-width: 300px; }
        .image-container img { width: 100%; border: 1px solid #ddd; border-radius: 4px; }
        .image-label { text-align: center; margin-top: 5px; font-weight: bold; }
        .metrics { background: #f9f9f9; padding: 10px; border-radius: 4px; margin-top: 10px; }
        .metrics span { margin-right: 15px; }
    </style>
</head>
<body>
    <div class="header">
        <h1>Visual Regression Test Report</h1>
        <p>Generated: ${reportData.timestamp}</p>
        <p>Threshold: ${reportData.summary.threshold}%</p>
    </div>
    
    <div class="summary">
        <div class="stat">
            <div style="font-size: 24px; font-weight: bold;">${reportData.summary.total}</div>
            <div>Total Tests</div>
        </div>
        <div class="stat passed">
            <div style="font-size: 24px; font-weight: bold; color: #4CAF50;">${reportData.summary.passed}</div>
            <div>Passed</div>
        </div>
        <div class="stat failed">
            <div style="font-size: 24px; font-weight: bold; color: #f44336;">${reportData.summary.failed}</div>
            <div>Failed</div>
        </div>
    </div>

    ${reportData.tests.map((test: any) => `
        <div class="test ${test.passed ? 'passed' : 'failed'}">
            <div class="test-header">
                <h3>${test.name} ${test.passed ? '✅' : '❌'}</h3>
                <div class="metrics">
                    <span><strong>Pixel Difference:</strong> ${test.pixelDifference}</span>
                    <span><strong>Percentage:</strong> ${test.percentageDifference.toFixed(2)}%</span>
                    <span><strong>Dimensions:</strong> ${test.dimensions}</span>
                </div>
            </div>
            <div class="test-content">
                <div class="images">
                    <div class="image-container">
                        <img src="${test.baseline}" alt="Baseline">
                        <div class="image-label">Baseline</div>
                    </div>
                    <div class="image-container">
                        <img src="${test.current}" alt="Current">
                        <div class="image-label">Current</div>
                    </div>
                    ${test.diff ? `
                        <div class="image-container">
                            <img src="${test.diff}" alt="Difference">
                            <div class="image-label">Difference</div>
                        </div>
                    ` : ''}
                </div>
            </div>
        </div>
    `).join('')}
</body>
</html>`;

    const htmlPath = path.join(this.screenshotDir, 'visual-test-report.html');
    await fs.writeFile(htmlPath, htmlContent, 'utf8');
    
    return htmlPath;
  }

  /**
   * Clean up old screenshots
   */
  async cleanupOldScreenshots(daysOld: number = 7): Promise<void> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysOld);

    const dirs = [this.screenshotDir, this.diffDir];

    for (const dir of dirs) {
      try {
        const files = await fs.readdir(dir);
        
        for (const file of files) {
          const filePath = path.join(dir, file);
          const stats = await fs.stat(filePath);
          
          if (stats.mtime < cutoffDate && file.endsWith('.png')) {
            await fs.remove(filePath);
            console.log(`🧹 Cleaned up old screenshot: ${file}`);
          }
        }
      } catch (error) {
        console.warn(`⚠️ Failed to cleanup ${dir}: ${error.message}`);
      }
    }
  }

  /**
   * Set default threshold for comparisons
   */
  setThreshold(threshold: number): void {
    this.threshold = threshold;
  }

  /**
   * Get current threshold
   */
  getThreshold(): number {
    return this.threshold;
  }
}