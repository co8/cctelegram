#!/usr/bin/env node

import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';
import matter from 'gray-matter';
import { unified } from 'unified';
import remarkParse from 'remark-parse';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

/**
 * Documentation Quality Metrics Generator
 * 
 * Analyzes documentation completeness, freshness, and quality
 * Generates metrics dashboard and quality reports
 */
class DocumentationMetrics {
  constructor() {
    this.docsDir = projectRoot;
    this.reportsDir = path.join(projectRoot, 'reports');
    this.metricsFile = path.join(this.reportsDir, 'docs-metrics.json');
    this.dashboardFile = path.join(this.reportsDir, 'metrics-dashboard.html');
  }

  async ensureReportsDir() {
    await fs.ensureDir(this.reportsDir);
  }

  async findMarkdownFiles() {
    const files = [];
    
    const walkDir = async (dir, relativePath = '') => {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        const relPath = path.join(relativePath, entry.name);
        
        if (entry.isDirectory()) {
          // Skip certain directories
          if (!['node_modules', '.vitepress', 'coverage', '.git'].includes(entry.name)) {
            await walkDir(fullPath, relPath);
          }
        } else if (entry.name.endsWith('.md')) {
          files.push({
            path: fullPath,
            relativePath: relPath,
            name: entry.name
          });
        }
      }
    };
    
    await walkDir(this.docsDir);
    return files;
  }

  async analyzeMarkdownFile(file) {
    const content = await fs.readFile(file.path, 'utf-8');
    const { data: frontmatter, content: markdownContent } = matter(content);
    
    // Parse markdown AST
    const processor = unified().use(remarkParse);
    const ast = processor.parse(markdownContent);
    
    const analysis = {
      path: file.relativePath,
      name: file.name,
      size: content.length,
      lines: content.split('\n').length,
      wordCount: markdownContent.split(/\s+/).filter(word => word.length > 0).length,
      characterCount: markdownContent.length,
      frontmatter,
      
      // Content structure analysis
      headings: this.extractHeadings(ast),
      links: this.extractLinks(ast),
      images: this.extractImages(ast),
      codeBlocks: this.extractCodeBlocks(ast),
      
      // Quality metrics
      readingTime: Math.ceil(markdownContent.split(/\s+/).length / 200), // Assuming 200 WPM
      complexity: this.calculateComplexity(markdownContent, ast),
      lastModified: (await fs.stat(file.path)).mtime,
      
      // Completeness checks
      hasTitle: this.hasTitle(ast),
      hasIntroduction: this.hasIntroduction(markdownContent),
      hasExamples: this.hasExamples(markdownContent),
      hasTableOfContents: this.hasTableOfContents(markdownContent),
      
      // SEO and metadata
      hasDescription: Boolean(frontmatter.description),
      hasKeywords: Boolean(frontmatter.keywords),
      titleLength: this.getTitleLength(ast),
      descriptionLength: frontmatter.description ? frontmatter.description.length : 0
    };
    
    return analysis;
  }

  extractHeadings(ast) {
    const headings = [];
    
    const visit = (node) => {
      if (node.type === 'heading') {
        const text = this.extractTextFromNode(node);
        headings.push({
          level: node.depth,
          text,
          anchor: text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
        });
      }
      
      if (node.children) {
        node.children.forEach(visit);
      }
    };
    
    visit(ast);
    return headings;
  }

  extractLinks(ast) {
    const links = [];
    
    const visit = (node) => {
      if (node.type === 'link') {
        links.push({
          url: node.url,
          title: node.title || '',
          text: this.extractTextFromNode(node),
          isExternal: node.url.startsWith('http'),
          isImage: false
        });
      }
      
      if (node.children) {
        node.children.forEach(visit);
      }
    };
    
    visit(ast);
    return links;
  }

  extractImages(ast) {
    const images = [];
    
    const visit = (node) => {
      if (node.type === 'image') {
        images.push({
          url: node.url,
          alt: node.alt || '',
          title: node.title || ''
        });
      }
      
      if (node.children) {
        node.children.forEach(visit);
      }
    };
    
    visit(ast);
    return images;
  }

  extractCodeBlocks(ast) {
    const codeBlocks = [];
    
    const visit = (node) => {
      if (node.type === 'code') {
        codeBlocks.push({
          language: node.lang || 'text',
          value: node.value,
          lines: node.value.split('\n').length
        });
      }
      
      if (node.children) {
        node.children.forEach(visit);
      }
    };
    
    visit(ast);
    return codeBlocks;
  }

  extractTextFromNode(node) {
    if (node.type === 'text') {
      return node.value;
    }
    
    if (node.children) {
      return node.children.map(child => this.extractTextFromNode(child)).join('');
    }
    
    return '';
  }

  calculateComplexity(content, ast) {
    let complexity = 0;
    
    // Word count contributes to complexity
    const wordCount = content.split(/\s+/).length;
    complexity += Math.min(wordCount / 100, 10); // Max 10 points for word count
    
    // Heading structure complexity
    const headings = this.extractHeadings(ast);
    const maxDepth = Math.max(...headings.map(h => h.level), 0);
    complexity += maxDepth * 0.5;
    
    // Code blocks add complexity
    const codeBlocks = this.extractCodeBlocks(ast);
    complexity += codeBlocks.length * 0.3;
    
    // Links and images add moderate complexity
    const links = this.extractLinks(ast);
    const images = this.extractImages(ast);
    complexity += (links.length + images.length) * 0.1;
    
    return Math.min(complexity, 20); // Cap at 20
  }

  hasTitle(ast) {
    return this.extractHeadings(ast).some(h => h.level === 1);
  }

  hasIntroduction(content) {
    const firstParagraph = content.split('\n\n')[0];
    return firstParagraph && firstParagraph.length > 50;
  }

  hasExamples(content) {
    const lowerContent = content.toLowerCase();
    return lowerContent.includes('example') || 
           lowerContent.includes('demo') ||
           lowerContent.includes('```') ||
           lowerContent.includes('sample');
  }

  hasTableOfContents(content) {
    const lowerContent = content.toLowerCase();
    return lowerContent.includes('table of contents') ||
           lowerContent.includes('toc') ||
           lowerContent.includes('## contents');
  }

  getTitleLength(ast) {
    const title = this.extractHeadings(ast).find(h => h.level === 1);
    return title ? title.text.length : 0;
  }

  async runLinkChecker() {
    try {
      console.log('🔗 Running link checker...');
      execSync('npm run links:check:ci', { cwd: this.docsDir, stdio: 'pipe' });
      
      const linkResultsFile = path.join(this.docsDir, 'link-check-results.csv');
      if (await fs.pathExists(linkResultsFile)) {
        const csvContent = await fs.readFile(linkResultsFile, 'utf-8');
        return this.parseLinkResults(csvContent);
      }
    } catch (error) {
      console.warn('Link checker failed:', error.message);
    }
    
    return { totalLinks: 0, brokenLinks: 0, warnings: 0 };
  }

  parseLinkResults(csvContent) {
    const lines = csvContent.split('\n').filter(line => line.trim());
    const results = { totalLinks: 0, brokenLinks: 0, warnings: 0, details: [] };
    
    for (const line of lines) {
      const [status, url, source] = line.split(',').map(cell => cell.trim());
      results.totalLinks++;
      
      if (status && status !== '200') {
        if (status.startsWith('4') || status.startsWith('5')) {
          results.brokenLinks++;
        } else {
          results.warnings++;
        }
        
        results.details.push({ status, url, source });
      }
    }
    
    return results;
  }

  async runSpellChecker() {
    try {
      console.log('🔤 Running spell checker...');
      execSync('npm run spell:check:ci', { cwd: this.docsDir, stdio: 'pipe' });
      
      const spellResultsFile = path.join(this.docsDir, 'spell-check-results.json');
      if (await fs.pathExists(spellResultsFile)) {
        const results = JSON.parse(await fs.readFile(spellResultsFile, 'utf-8'));
        return {
          totalFiles: results.length,
          filesWithErrors: results.filter(r => r.issues?.length > 0).length,
          totalIssues: results.reduce((sum, r) => sum + (r.issues?.length || 0), 0),
          details: results
        };
      }
    } catch (error) {
      console.warn('Spell checker failed:', error.message);
    }
    
    return { totalFiles: 0, filesWithErrors: 0, totalIssues: 0, details: [] };
  }

  calculateQualityScore(analysis) {
    let score = 100;
    
    // Content completeness (40 points)
    if (!analysis.hasTitle) score -= 10;
    if (!analysis.hasIntroduction) score -= 8;
    if (!analysis.hasExamples) score -= 5;
    if (!analysis.hasDescription) score -= 7;
    if (analysis.wordCount < 100) score -= 10;
    
    // Structure and navigation (25 points)
    if (analysis.headings.length < 2) score -= 8;
    if (analysis.headings.length > 8) score -= 5;
    if (!analysis.hasTableOfContents && analysis.wordCount > 500) score -= 5;
    if (analysis.titleLength > 60) score -= 4;
    if (analysis.descriptionLength > 160) score -= 3;
    
    // Freshness (20 points)
    const daysSinceModified = (Date.now() - analysis.lastModified) / (1000 * 60 * 60 * 24);
    if (daysSinceModified > 365) score -= 15;
    else if (daysSinceModified > 180) score -= 10;
    else if (daysSinceModified > 90) score -= 5;
    
    // Complexity and readability (15 points)
    if (analysis.complexity > 15) score -= 8;
    if (analysis.readingTime > 20) score -= 4;
    if (analysis.wordCount > 3000) score -= 3;
    
    return Math.max(score, 0);
  }

  async generateMetrics() {
    console.log('📊 Generating documentation metrics...');
    
    await this.ensureReportsDir();
    
    const files = await this.findMarkdownFiles();
    console.log(`Found ${files.length} markdown files`);
    
    const analyses = [];
    for (const file of files) {
      try {
        const analysis = await this.analyzeMarkdownFile(file);
        analysis.qualityScore = this.calculateQualityScore(analysis);
        analyses.push(analysis);
        console.log(`✅ Analyzed: ${file.relativePath} (Score: ${analysis.qualityScore})`);
      } catch (error) {
        console.warn(`⚠️  Failed to analyze ${file.relativePath}:`, error.message);
      }
    }
    
    // Run quality checks
    const linkResults = await this.runLinkChecker();
    const spellResults = await this.runSpellChecker();
    
    // Calculate overall metrics
    const totalWords = analyses.reduce((sum, a) => sum + a.wordCount, 0);
    const totalPages = analyses.length;
    const averageQuality = analyses.reduce((sum, a) => sum + a.qualityScore, 0) / totalPages;
    const lowQualityPages = analyses.filter(a => a.qualityScore < 70).length;
    const highQualityPages = analyses.filter(a => a.qualityScore >= 90).length;
    
    const metrics = {
      generatedAt: new Date().toISOString(),
      summary: {
        totalPages,
        totalWords,
        averageWordsPerPage: Math.round(totalWords / totalPages),
        averageQualityScore: Math.round(averageQuality * 100) / 100,
        highQualityPages,
        lowQualityPages,
        qualityDistribution: {
          excellent: analyses.filter(a => a.qualityScore >= 90).length,
          good: analyses.filter(a => a.qualityScore >= 80 && a.qualityScore < 90).length,
          fair: analyses.filter(a => a.qualityScore >= 70 && a.qualityScore < 80).length,
          poor: analyses.filter(a => a.qualityScore < 70).length
        }
      },
      linkCheck: linkResults,
      spellCheck: spellResults,
      pages: analyses.map(a => ({
        path: a.path,
        name: a.name,
        wordCount: a.wordCount,
        qualityScore: a.qualityScore,
        lastModified: a.lastModified,
        issues: {
          noTitle: !a.hasTitle,
          noIntroduction: !a.hasIntroduction,
          noExamples: !a.hasExamples,
          noDescription: !a.hasDescription,
          tooLong: a.wordCount > 3000,
          tooShort: a.wordCount < 100,
          outdated: (Date.now() - a.lastModified) / (1000 * 60 * 60 * 24) > 180
        }
      })),
      detailed: analyses
    };
    
    await fs.writeFile(this.metricsFile, JSON.stringify(metrics, null, 2));
    console.log(`✅ Metrics saved to: ${this.metricsFile}`);
    
    return metrics;
  }

  async generateDashboard(metrics) {
    console.log('📈 Generating metrics dashboard...');
    
    const html = this.createDashboardHTML(metrics);
    await fs.writeFile(this.dashboardFile, html);
    console.log(`✅ Dashboard saved to: ${this.dashboardFile}`);
  }

  createDashboardHTML(metrics) {
    const { summary, linkCheck, spellCheck, pages } = metrics;
    
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Documentation Metrics Dashboard</title>
  <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 0; padding: 20px; background: #f5f5f5; }
    .container { max-width: 1200px; margin: 0 auto; }
    .header { text-align: center; margin-bottom: 40px; }
    .metrics-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 20px; margin-bottom: 40px; }
    .metric-card { background: white; border-radius: 8px; padding: 20px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
    .metric-value { font-size: 2em; font-weight: bold; color: #2563eb; }
    .metric-label { color: #6b7280; margin-top: 8px; }
    .chart-container { background: white; border-radius: 8px; padding: 20px; margin-bottom: 20px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
    .pages-table { width: 100%; border-collapse: collapse; background: white; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
    .pages-table th, .pages-table td { padding: 12px; text-align: left; border-bottom: 1px solid #e5e7eb; }
    .pages-table th { background: #f9fafb; font-weight: 600; }
    .quality-score { padding: 4px 8px; border-radius: 4px; color: white; font-weight: 500; }
    .quality-excellent { background: #10b981; }
    .quality-good { background: #3b82f6; }
    .quality-fair { background: #f59e0b; }
    .quality-poor { background: #ef4444; }
    .timestamp { color: #6b7280; font-size: 0.9em; text-align: center; margin-top: 40px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>📚 Documentation Metrics Dashboard</h1>
      <p>Quality analysis for CCTelegram MCP Server documentation</p>
    </div>
    
    <div class="metrics-grid">
      <div class="metric-card">
        <div class="metric-value">${summary.totalPages}</div>
        <div class="metric-label">Total Pages</div>
      </div>
      
      <div class="metric-card">
        <div class="metric-value">${summary.totalWords.toLocaleString()}</div>
        <div class="metric-label">Total Words</div>
      </div>
      
      <div class="metric-card">
        <div class="metric-value">${summary.averageQualityScore}/100</div>
        <div class="metric-label">Average Quality Score</div>
      </div>
      
      <div class="metric-card">
        <div class="metric-value">${linkCheck.brokenLinks}</div>
        <div class="metric-label">Broken Links</div>
      </div>
    </div>
    
    <div class="chart-container">
      <h3>Quality Distribution</h3>
      <canvas id="qualityChart" width="400" height="200"></canvas>
    </div>
    
    <div class="chart-container">
      <h3>Link Check Results</h3>
      <canvas id="linkChart" width="400" height="200"></canvas>
    </div>
    
    <div class="chart-container">
      <h3>Page Details</h3>
      <table class="pages-table">
        <thead>
          <tr>
            <th>Page</th>
            <th>Word Count</th>
            <th>Quality Score</th>
            <th>Last Modified</th>
            <th>Issues</th>
          </tr>
        </thead>
        <tbody>
          ${pages.map(page => `
            <tr>
              <td>${page.path}</td>
              <td>${page.wordCount}</td>
              <td>
                <span class="quality-score ${
                  page.qualityScore >= 90 ? 'quality-excellent' :
                  page.qualityScore >= 80 ? 'quality-good' :
                  page.qualityScore >= 70 ? 'quality-fair' : 'quality-poor'
                }">${page.qualityScore}</span>
              </td>
              <td>${new Date(page.lastModified).toLocaleDateString()}</td>
              <td>${Object.values(page.issues).filter(Boolean).length}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
    
    <div class="timestamp">
      Generated on ${new Date(metrics.generatedAt).toLocaleString()}
    </div>
  </div>
  
  <script>
    // Quality Distribution Chart
    const qualityCtx = document.getElementById('qualityChart').getContext('2d');
    new Chart(qualityCtx, {
      type: 'doughnut',
      data: {
        labels: ['Excellent (90-100)', 'Good (80-89)', 'Fair (70-79)', 'Poor (<70)'],
        datasets: [{
          data: [
            ${summary.qualityDistribution.excellent},
            ${summary.qualityDistribution.good},
            ${summary.qualityDistribution.fair},
            ${summary.qualityDistribution.poor}
          ],
          backgroundColor: ['#10b981', '#3b82f6', '#f59e0b', '#ef4444']
        }]
      },
      options: {
        responsive: true,
        plugins: {
          legend: { position: 'bottom' }
        }
      }
    });
    
    // Link Check Chart
    const linkCtx = document.getElementById('linkChart').getContext('2d');
    new Chart(linkCtx, {
      type: 'bar',
      data: {
        labels: ['Working Links', 'Broken Links', 'Warnings'],
        datasets: [{
          data: [
            ${linkCheck.totalLinks - linkCheck.brokenLinks - linkCheck.warnings},
            ${linkCheck.brokenLinks},
            ${linkCheck.warnings}
          ],
          backgroundColor: ['#10b981', '#ef4444', '#f59e0b']
        }]
      },
      options: {
        responsive: true,
        plugins: {
          legend: { display: false }
        },
        scales: {
          y: { beginAtZero: true }
        }
      }
    });
  </script>
</body>
</html>`;
  }

  async run() {
    try {
      const metrics = await this.generateMetrics();
      await this.generateDashboard(metrics);
      
      console.log('\\n📊 Documentation Metrics Summary:');
      console.log(`   Total Pages: ${metrics.summary.totalPages}`);
      console.log(`   Average Quality: ${metrics.summary.averageQualityScore}/100`);
      console.log(`   Broken Links: ${metrics.linkCheck.brokenLinks}`);
      console.log(`   Spelling Issues: ${metrics.spellCheck.totalIssues}`);
      console.log(`\\n📈 Dashboard: ${this.dashboardFile}`);
      
    } catch (error) {
      console.error('❌ Metrics generation failed:', error);
      process.exit(1);
    }
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  new DocumentationMetrics().run();
}

export default DocumentationMetrics;