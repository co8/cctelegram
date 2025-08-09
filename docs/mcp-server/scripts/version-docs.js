#!/usr/bin/env node

import fs from 'fs-extra';
import path from 'path';
import semver from 'semver';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

/**
 * Documentation Versioning Script
 * 
 * Creates versioned documentation copies and updates version metadata
 * Supports semantic release integration
 */
class DocumentationVersioner {
  constructor() {
    this.versionsFile = path.join(projectRoot, 'versions.json');
    this.docsDir = path.join(projectRoot);
    this.archiveDir = path.join(projectRoot, '..', '..', 'docs-archive');
  }

  async loadVersions() {
    try {
      const content = await fs.readFile(this.versionsFile, 'utf-8');
      return JSON.parse(content);
    } catch (error) {
      console.warn('Could not load versions.json, using defaults');
      return {
        versions: [],
        preReleases: [],
        branches: { main: 'stable', beta: 'beta', alpha: 'alpha' },
        defaultVersion: 'v1.0.0',
        supportedVersions: [],
        archivedVersions: []
      };
    }
  }

  async saveVersions(versions) {
    await fs.writeFile(this.versionsFile, JSON.stringify(versions, null, 2));
  }

  async getCurrentVersion() {
    const packageFile = path.join(projectRoot, '..', 'package.json');
    const pkg = JSON.parse(await fs.readFile(packageFile, 'utf-8'));
    return `v${pkg.version}`;
  }

  async getBranchInfo() {
    try {
      const branch = execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf-8' }).trim();
      const commitHash = execSync('git rev-parse --short HEAD', { encoding: 'utf-8' }).trim();
      const timestamp = new Date().toISOString();
      return { branch, commitHash, timestamp };
    } catch (error) {
      console.warn('Could not get git info:', error.message);
      return { branch: 'main', commitHash: 'unknown', timestamp: new Date().toISOString() };
    }
  }

  determineVersionStatus(version, branch) {
    if (branch === 'main') return 'stable';
    if (branch === 'beta' || version.includes('beta')) return 'beta';
    if (branch === 'alpha' || version.includes('alpha')) return 'alpha';
    if (branch === 'develop') return 'development';
    return 'stable';
  }

  async createVersionedDocs(version, status) {
    console.log(`📚 Creating versioned docs for ${version} (${status})`);
    
    // Create archive directory
    await fs.ensureDir(this.archiveDir);
    
    // Build current docs
    console.log('Building current documentation...');
    execSync('npm run docs:build', { stdio: 'inherit', cwd: projectRoot });
    
    // Create version-specific archive
    const versionArchive = path.join(this.archiveDir, `docs-${version}.tar.gz`);
    const distDir = path.join(projectRoot, '.vitepress', 'dist');
    
    if (await fs.pathExists(distDir)) {
      console.log(`Creating archive: ${versionArchive}`);
      execSync(`tar -czf "${versionArchive}" -C "${distDir}" .`, { stdio: 'inherit' });
    }
    
    // Copy to version-specific directory if this is a stable release
    if (status === 'stable') {
      const versionDir = path.join(this.archiveDir, version);
      await fs.copy(distDir, versionDir);
      console.log(`Copied docs to: ${versionDir}`);
    }
  }

  async updateVersionMetadata(newVersion, status) {
    const versions = await this.loadVersions();
    const branchInfo = await this.getBranchInfo();
    
    const versionEntry = {
      version: newVersion,
      label: `${newVersion}${status === 'stable' ? '' : ` (${status.toUpperCase()})`}`,
      path: status === 'stable' ? `/docs/${newVersion}/` : `/docs/${status}/`,
      isLatest: status === 'stable',
      releaseDate: new Date().toISOString().split('T')[0],
      status,
      branch: branchInfo.branch,
      commitHash: branchInfo.commitHash
    };

    if (status === 'stable') {
      // Mark previous versions as not latest
      versions.versions.forEach(v => { v.isLatest = false; });
      
      // Add to stable versions
      versions.versions.unshift(versionEntry);
      versions.defaultVersion = newVersion;
      
      // Update supported versions (keep latest 3 stable versions)
      versions.supportedVersions = versions.versions
        .filter(v => v.status === 'stable')
        .slice(0, 3)
        .map(v => v.version);
      
      // Archive older versions (beyond 5 stable versions)
      const stableVersions = versions.versions.filter(v => v.status === 'stable');
      if (stableVersions.length > 5) {
        const toArchive = stableVersions.slice(5);
        toArchive.forEach(v => {
          v.status = 'archived';
          versions.archivedVersions.push(v.version);
        });
        versions.versions = versions.versions.filter(v => 
          v.status !== 'stable' || stableVersions.slice(0, 5).includes(v)
        );
      }
    } else {
      // Handle pre-releases
      versions.preReleases = versions.preReleases || [];
      
      // Remove existing pre-release of same type
      versions.preReleases = versions.preReleases.filter(v => 
        !v.version.includes(status)
      );
      
      // Add new pre-release
      versions.preReleases.unshift(versionEntry);
      
      // Keep only latest 3 pre-releases
      versions.preReleases = versions.preReleases.slice(0, 3);
    }

    await this.saveVersions(versions);
    console.log(`✅ Updated version metadata for ${newVersion}`);
  }

  async generateVersionsPage() {
    const versions = await this.loadVersions();
    const versionsPageContent = this.createVersionsPageMarkdown(versions);
    
    const versionsPagePath = path.join(projectRoot, 'versions.md');
    await fs.writeFile(versionsPagePath, versionsPageContent);
    console.log('✅ Generated versions.md page');
  }

  createVersionsPageMarkdown(versions) {
    return `# Documentation Versions

This page lists all available versions of the CCTelegram MCP Server documentation.

## Current Stable Version

${versions.versions.filter(v => v.isLatest && v.status === 'stable').map(v => `
### ${v.version} (Latest)
- **Status**: ${v.status.toUpperCase()}
- **Release Date**: ${v.releaseDate}
- **Documentation**: [View Docs](${v.path})
`).join('')}

## Stable Versions

${versions.versions.filter(v => v.status === 'stable').map(v => `
### ${v.version}${v.isLatest ? ' (Latest)' : ''}
- **Release Date**: ${v.releaseDate}
- **Documentation**: [View Docs](${v.path})
- **Support Status**: ${versions.supportedVersions.includes(v.version) ? '✅ Supported' : '❌ Unsupported'}
`).join('')}

${versions.preReleases.length ? `
## Pre-release Versions

${versions.preReleases.map(v => `
### ${v.version}
- **Status**: ${v.status.toUpperCase()}
- **Release Date**: ${v.releaseDate}
- **Documentation**: [View Docs](${v.path})
- **Branch**: ${v.branch}
`).join('')}
` : ''}

${versions.archivedVersions.length ? `
## Archived Versions

The following versions are archived and no longer maintained:

${versions.versions.filter(v => v.status === 'archived').map(v => `
- **${v.version}** (Released: ${v.releaseDate})
`).join('')}
` : ''}

## Migration Guides

- [Migrating to v2.0](./migration/v2.0.html)
- [Migrating to v1.5](./migration/v1.5.html)
- [Breaking Changes History](./migration/breaking-changes.html)

## Support Policy

- **Latest stable version**: Full support with regular updates
- **Previous 2 stable versions**: Security updates and critical bug fixes
- **Archived versions**: No support, documentation available for reference

For questions about version support, please [open an issue](https://github.com/user/cctelegram/issues).
`;
  }

  async run() {
    try {
      const args = process.argv.slice(2);
      const versionFlag = args.find(arg => arg.startsWith('--version='));
      const version = versionFlag ? versionFlag.replace('--version=', '') : await this.getCurrentVersion();
      
      const branchInfo = await this.getBranchInfo();
      const status = this.determineVersionStatus(version, branchInfo.branch);
      
      console.log(`🚀 Versioning documentation for ${version} (${status})`);
      
      // Create versioned documentation
      await this.createVersionedDocs(version, status);
      
      // Update version metadata
      await this.updateVersionMetadata(version, status);
      
      // Generate versions page
      await this.generateVersionsPage();
      
      console.log(`✅ Documentation versioning complete for ${version}`);
      
    } catch (error) {
      console.error('❌ Documentation versioning failed:', error);
      process.exit(1);
    }
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  new DocumentationVersioner().run();
}

export default DocumentationVersioner;