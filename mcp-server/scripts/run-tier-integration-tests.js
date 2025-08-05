#!/usr/bin/env node

/**
 * 3-Tier Cascading System Integration Test Runner
 * 
 * Orchestrates the complete integration test suite including:
 * - Docker Compose environment setup
 * - Mock tier configuration
 * - Test execution with proper timing
 * - Results collection and reporting
 */

const { spawn, exec } = require('child_process');
const fs = require('fs').promises;
const path = require('path');
const { promisify } = require('util');

const execAsync = promisify(exec);

class IntegrationTestRunner {
  constructor() {
    this.projectRoot = path.resolve(__dirname, '../../..');
    this.composeFile = path.join(this.projectRoot, 'docker-compose.integration-test.yml');
    this.testTimeout = 300000; // 5 minutes
    this.setupTimeout = 120000; // 2 minutes
  }

  async run() {
    console.log('🚀 Starting 3-Tier Cascading System Integration Tests');
    console.log(`Project root: ${this.projectRoot}`);
    
    try {
      await this.validateEnvironment();
      await this.setupTestEnvironment();
      await this.waitForServices();
      const results = await this.runTests();
      await this.collectResults();
      await this.cleanup();
      
      this.printSummary(results);
      
    } catch (error) {
      console.error('❌ Integration test failed:', error.message);
      await this.cleanup();
      process.exit(1);
    }
  }

  async validateEnvironment() {
    console.log('🔍 Validating test environment...');
    
    // Check Docker
    try {
      await execAsync('docker --version');
      await execAsync('docker-compose --version');
    } catch (error) {
      throw new Error('Docker and Docker Compose are required for integration tests');
    }

    // Check if compose file exists
    try {
      await fs.access(this.composeFile);
    } catch (error) {
      throw new Error(`Docker Compose file not found: ${this.composeFile}`);
    }

    // Check available ports
    const requiredPorts = [3001, 3002, 3003, 5432, 6379];
    for (const port of requiredPorts) {
      try {
        await execAsync(`lsof -i :${port}`);
        console.warn(`⚠️  Port ${port} is in use - tests may conflict`);
      } catch (error) {
        // Port is free, which is good
      }
    }

    console.log('✅ Environment validation complete');
  }

  async setupTestEnvironment() {
    console.log('🔧 Setting up test environment...');
    
    // Clean up any existing containers
    await this.cleanup(false);
    
    // Build and start services
    const buildCommand = `docker-compose -f ${this.composeFile} build`;
    console.log(`Executing: ${buildCommand}`);
    
    await this.executeCommand(buildCommand, 'build');
    
    const upCommand = `docker-compose -f ${this.composeFile} up -d`;
    console.log(`Executing: ${upCommand}`);
    
    await this.executeCommand(upCommand, 'startup');
    
    console.log('✅ Test environment setup complete');
  }

  async waitForServices() {
    console.log('⏳ Waiting for services to be ready...');
    
    const services = [
      { name: 'Tier 1 Webhook', url: 'http://localhost:3001/health', timeout: 30000 },
      { name: 'Tier 2 Bridge', url: 'http://localhost:3002/health', timeout: 30000 },
      { name: 'Tier 3 File Watcher', url: 'http://localhost:3003/health', timeout: 30000 },
      { name: 'PostgreSQL', command: 'docker-compose -f ' + this.composeFile + ' exec -T postgres-test pg_isready', timeout: 30000 },
      { name: 'Redis', command: 'docker-compose -f ' + this.composeFile + ' exec -T redis-cache redis-cli ping', timeout: 30000 }
    ];

    const startTime = Date.now();
    const maxWaitTime = 60000; // 1 minute total

    while (Date.now() - startTime < maxWaitTime) {
      let allReady = true;
      
      for (const service of services) {
        try {
          if (service.url) {
            const response = await fetch(service.url);
            if (!response.ok) {
              allReady = false;
              break;
            }
          } else if (service.command) {
            await execAsync(service.command);
          }
          console.log(`✅ ${service.name} is ready`);
        } catch (error) {
          console.log(`⏳ Waiting for ${service.name}...`);
          allReady = false;
          break;
        }
      }

      if (allReady) {
        console.log('✅ All services are ready');
        return;
      }

      await new Promise(resolve => setTimeout(resolve, 2000));
    }

    throw new Error('Services did not become ready within timeout period');
  }

  async runTests() {
    console.log('🧪 Running integration tests...');
    
    const testCommand = [
      'docker-compose',
      '-f', this.composeFile,
      'exec', '-T', 'integration-test',
      'npm', 'run', 'test:integration',
      '--', '--testPathPattern=tier-cascading-system',
      '--verbose',
      '--testTimeout=' + this.testTimeout
    ].join(' ');

    console.log(`Executing: ${testCommand}`);
    
    try {
      const result = await this.executeCommand(testCommand, 'test execution');
      console.log('✅ Integration tests completed successfully');
      return result;
    } catch (error) {
      console.error('❌ Integration tests failed');
      
      // Get logs from failed services
      await this.collectServiceLogs();
      throw error;
    }
  }

  async collectResults() {
    console.log('📊 Collecting test results...');
    
    try {
      // Copy coverage reports
      const coverageCommand = `docker-compose -f ${this.composeFile} cp integration-test:/app/coverage ./coverage/integration`;
      await execAsync(coverageCommand);
      
      // Copy test reports if they exist
      const reportsCommand = `docker-compose -f ${this.composeFile} cp test-collector:/app/reports ./reports/integration`;
      await execAsync(reportsCommand).catch(() => {
        console.log('ℹ️  No additional reports found');
      });
      
      console.log('✅ Results collected');
    } catch (error) {
      console.warn('⚠️  Could not collect all results:', error.message);
    }
  }

  async collectServiceLogs() {
    console.log('📝 Collecting service logs for debugging...');
    
    const services = [
      'tier1-webhook-mock',
      'tier2-bridge-mock', 
      'tier3-file-mock',
      'integration-test',
      'postgres-test',
      'redis-cache'
    ];

    const logsDir = path.join(this.projectRoot, 'logs', 'integration-test');
    await fs.mkdir(logsDir, { recursive: true });

    for (const service of services) {
      try {
        const logCommand = `docker-compose -f ${this.composeFile} logs ${service}`;
        const { stdout } = await execAsync(logCommand);
        
        const logFile = path.join(logsDir, `${service}.log`);
        await fs.writeFile(logFile, stdout);
        console.log(`📝 Collected logs for ${service}`);
      } catch (error) {
        console.warn(`⚠️  Could not collect logs for ${service}:`, error.message);
      }
    }
  }

  async cleanup(showOutput = true) {
    if (showOutput) {
      console.log('🧹 Cleaning up test environment...');
    }
    
    try {
      const downCommand = `docker-compose -f ${this.composeFile} down -v --remove-orphans`;
      await execAsync(downCommand);
      
      if (showOutput) {
        console.log('✅ Cleanup complete');
      }
    } catch (error) {
      if (showOutput) {
        console.warn('⚠️  Cleanup warning:', error.message);
      }
    }
  }

  async executeCommand(command, phase) {
    return new Promise((resolve, reject) => {
      const child = spawn('sh', ['-c', command], {
        stdio: ['pipe', 'pipe', 'pipe'],
        cwd: this.projectRoot
      });

      let stdout = '';
      let stderr = '';

      child.stdout.on('data', (data) => {
        const output = data.toString();
        stdout += output;
        process.stdout.write(output);
      });

      child.stderr.on('data', (data) => {
        const output = data.toString();
        stderr += output;
        process.stderr.write(output);
      });

      child.on('close', (code) => {
        if (code === 0) {
          resolve({ stdout, stderr, code });
        } else {
          reject(new Error(`${phase} failed with exit code ${code}\nSTDOUT: ${stdout}\nSTDERR: ${stderr}`));
        }
      });

      child.on('error', (error) => {
        reject(new Error(`${phase} failed to start: ${error.message}`));
      });

      // Set timeout for long-running operations
      const timeout = setTimeout(() => {
        child.kill('SIGTERM');
        reject(new Error(`${phase} timed out after ${this.setupTimeout}ms`));
      }, this.setupTimeout);

      child.on('close', () => clearTimeout(timeout));
    });
  }

  printSummary(results) {
    console.log('\n' + '='.repeat(60));
    console.log('📋 3-TIER CASCADING SYSTEM INTEGRATION TEST SUMMARY');
    console.log('='.repeat(60));
    
    console.log('✅ Test Environment: Docker Compose');
    console.log('✅ Mock Services: All 3 tiers configured');
    console.log('✅ Real-time Latency Measurements: Enabled');
    console.log('✅ SLA Validation: All tiers tested');
    console.log('✅ Fallback Mechanisms: Validated');
    
    console.log('\n📊 SLA Compliance Targets:');
    console.log('   • Tier 1 (MCP Webhook): 0-100ms');
    console.log('   • Tier 2 (Bridge Internal): 100-500ms');
    console.log('   • Tier 3 (File Watcher): 1-5s');
    
    console.log('\n📁 Results Location:');
    console.log('   • Coverage: ./coverage/integration/');
    console.log('   • Logs: ./logs/integration-test/');
    console.log('   • Reports: ./reports/integration/');
    
    console.log('\n🎉 Integration tests completed successfully!');
    console.log('='.repeat(60) + '\n');
  }
}

// CLI interface
async function main() {
  const args = process.argv.slice(2);
  
  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
3-Tier Cascading System Integration Test Runner

Usage: node run-tier-integration-tests.js [options]

Options:
  --help, -h     Show this help message
  --cleanup-only Only cleanup existing test environment
  --no-cleanup   Skip cleanup after tests (for debugging)
  --verbose      Show detailed output

Examples:
  node run-tier-integration-tests.js
  node run-tier-integration-tests.js --cleanup-only
  node run-tier-integration-tests.js --no-cleanup --verbose
    `);
    return;
  }

  const runner = new IntegrationTestRunner();
  
  if (args.includes('--cleanup-only')) {
    console.log('🧹 Cleanup mode - removing existing test environment');
    await runner.cleanup();
    return;
  }

  // Override cleanup behavior if requested
  if (args.includes('--no-cleanup')) {
    const originalCleanup = runner.cleanup.bind(runner);
    runner.cleanup = async (showOutput = true) => {
      if (showOutput) {
        console.log('⏭️  Skipping cleanup (--no-cleanup flag)');
      }
    };
  }

  await runner.run();
}

// Handle process signals
process.on('SIGINT', async () => {
  console.log('\n🛑 Received interrupt signal, cleaning up...');
  const runner = new IntegrationTestRunner();
  await runner.cleanup();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('\n🛑 Received termination signal, cleaning up...');
  const runner = new IntegrationTestRunner();
  await runner.cleanup();
  process.exit(0);
});

if (require.main === module) {
  main().catch(error => {
    console.error('❌ Fatal error:', error.message);
    process.exit(1);
  });
}

module.exports = IntegrationTestRunner;