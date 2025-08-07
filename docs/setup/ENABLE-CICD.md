# Re-enable CI/CD Instructions

## To Re-enable GitHub Actions

When ready for production deployment, run:

```bash
cd /Users/enrique/Documents/cctelegram/.github
mv workflows-disabled workflows
```

This will restore all 13 GitHub Actions workflows:

- **ci-cd-pipeline.yml** - Main CI/CD pipeline with build, test, security
- **quality-gates.yml** - Quality gates and comprehensive testing  
- **coverage-quality-gates.yml** - Code coverage validation
- **security-enhanced.yml** - Enhanced security scanning
- **security-vulnerability-scanning.yml** - Dependency vulnerability checks
- **claude-code-review.yml** - Automated code review with Claude
- **performance-regression.yml** - Performance testing and regression detection
- **deployment-pipeline.yml** - Automated deployment to staging/production
- **pipeline-monitoring.yml** - Pipeline health monitoring
- **docs-quality-gates.yml** - Documentation quality validation
- **slsa-provenance.yml** - Supply chain security attestation
- **scorecard.yml** - OpenSSF security scorecard
- **claude.yml** - Claude Code integration workflow

## Status

**Current Status**: CI/CD DISABLED for development
**Disabled Date**: 2025-08-06
**Location**: `/Users/enrique/Documents/cctelegram/.github/workflows-disabled/`

## Development Notes

With CI/CD disabled, you can:
- Commit frequently without triggering builds
- Push experimental branches without running full pipeline
- Test locally without waiting for CI validation
- Iterate quickly during development phase

Remember to re-enable before production deployment!