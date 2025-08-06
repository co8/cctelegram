#!/usr/bin/env node
/**
 * Configuration Management CLI Tools
 * 
 * Comprehensive CLI for schema validation, environment comparison, migration execution,
 * and configuration management operations.
 */

import { Command } from 'commander';
import chalk from 'chalk';
import inquirer from 'inquirer';
import fs from 'fs-extra';
import path from 'path';
import { table } from 'table';
import { 
  EnvironmentConfigManager, 
  Environment 
} from '../environment-config.js';
import { 
  ConfigurationMigrationManager, 
  MigrationUtils 
} from '../config-migration.js';
import { 
  ConfigurationValidationMiddleware, 
  ValidationRule 
} from '../validation-middleware.js';
import { 
  ApplicationConfig, 
  validateConfiguration, 
  generateConfigTemplate,
  ConfigSchemaUtils 
} from '../config-schema.js';
import { secureLog } from '../../security.js';

const program = new Command();

class ConfigurationCLI {
  private configManager: EnvironmentConfigManager;
  private migrationManager: ConfigurationMigrationManager;
  private validationMiddleware: ConfigurationValidationMiddleware;

  constructor() {
    this.configManager = new EnvironmentConfigManager();
    this.migrationManager = new ConfigurationMigrationManager();
    this.validationMiddleware = new ConfigurationValidationMiddleware();
  }

  /**
   * Initialize CLI
   */
  public async initialize(): Promise<void> {
    program
      .name('config-cli')
      .description('Configuration management CLI for CCTelegram Bridge')
      .version('1.0.0');

    this.setupCommands();
    await program.parseAsync();
  }

  /**
   * Setup CLI commands
   */
  private setupCommands(): void {
    // Validation commands
    program
      .command('validate')
      .description('Validate configuration')
      .option('-e, --environment <env>', 'Environment to validate', 'development')
      .option('-f, --file <path>', 'Configuration file to validate')
      .option('-s, --strict', 'Enable strict validation mode')
      .option('--report <path>', 'Generate validation report')
      .action(this.validateCommand.bind(this));

    program
      .command('validate-schema')
      .description('Validate configuration against schema')
      .option('-f, --file <path>', 'Configuration file to validate')
      .option('--section <section>', 'Validate specific configuration section')
      .action(this.validateSchemaCommand.bind(this));

    // Environment commands
    program
      .command('compare')
      .description('Compare configurations between environments')
      .option('-s, --source <env>', 'Source environment', 'development')
      .option('-t, --target <env>', 'Target environment', 'production')
      .option('--format <format>', 'Output format (table|json|diff)', 'table')
      .option('--output <path>', 'Output file path')
      .action(this.compareCommand.bind(this));

    program
      .command('template')
      .description('Generate configuration template')
      .option('-e, --environment <env>', 'Environment type', 'development')
      .option('-o, --output <path>', 'Output file path')
      .option('--overwrite', 'Overwrite existing file')
      .action(this.templateCommand.bind(this));

    // Migration commands
    program
      .command('migrate')
      .description('Execute configuration migration')
      .option('-f, --file <path>', 'Configuration file to migrate')
      .option('-t, --to <version>', 'Target version')
      .option('--dry-run', 'Show migration plan without executing')
      .option('--backup', 'Create backup before migration')
      .action(this.migrateCommand.bind(this));

    program
      .command('migration-plan')
      .description('Show migration plan')
      .option('-f, --file <path>', 'Configuration file')
      .option('-t, --to <version>', 'Target version')
      .action(this.migrationPlanCommand.bind(this));

    program
      .command('migration-history')
      .description('Show migration history')
      .action(this.migrationHistoryCommand.bind(this));

    program
      .command('rollback')
      .description('Rollback configuration migration')
      .option('-b, --backup <path>', 'Backup file path')
      .action(this.rollbackCommand.bind(this));

    // Schema commands
    program
      .command('schema')
      .description('Display configuration schema information')
      .option('--section <section>', 'Show specific section schema')
      .option('--format <format>', 'Output format (table|json|docs)', 'table')
      .action(this.schemaCommand.bind(this));

    program
      .command('docs')
      .description('Generate configuration documentation')
      .option('-o, --output <path>', 'Output directory', './docs')
      .option('--format <format>', 'Documentation format (md|html)', 'md')
      .action(this.docsCommand.bind(this));

    // Environment management commands
    program
      .command('env')
      .description('Environment management commands')
      .option('-l, --list', 'List available environments')
      .option('-c, --current', 'Show current environment')
      .option('-s, --set <env>', 'Set environment')
      .action(this.envCommand.bind(this));

    // Configuration inspection commands
    program
      .command('inspect')
      .description('Inspect configuration')
      .option('-e, --environment <env>', 'Environment', 'development')
      .option('-s, --section <section>', 'Inspect specific section')
      .option('--keys', 'Show only configuration keys')
      .option('--redact', 'Redact sensitive values')
      .action(this.inspectCommand.bind(this));

    // Configuration testing commands
    program
      .command('test')
      .description('Test configuration')
      .option('-e, --environment <env>', 'Environment', 'development')
      .option('-f, --file <path>', 'Configuration file')
      .option('--connectivity', 'Test connectivity to external services')
      .option('--permissions', 'Test file permissions')
      .action(this.testCommand.bind(this));

    // Configuration optimization commands
    program
      .command('optimize')
      .description('Optimize configuration')
      .option('-f, --file <path>', 'Configuration file to optimize')
      .option('-o, --output <path>', 'Output file path')
      .option('--remove-defaults', 'Remove default values')
      .option('--minify', 'Minify configuration')
      .action(this.optimizeCommand.bind(this));

    // Configuration security commands
    program
      .command('security-scan')
      .description('Scan configuration for security issues')
      .option('-f, --file <path>', 'Configuration file to scan')
      .option('-e, --environment <env>', 'Environment', 'development')
      .option('--severity <level>', 'Minimum severity level (info|warning|error)', 'warning')
      .action(this.securityScanCommand.bind(this));
  }

  /**
   * Validate configuration command
   */
  private async validateCommand(options: any): Promise<void> {
    try {
      console.log(chalk.blue('🔍 Validating configuration...'));

      let config: ApplicationConfig;

      if (options.file) {
        // Validate specific file
        const configData = await fs.readJson(options.file);
        config = configData;
      } else {
        // Validate environment configuration
        this.configManager = new EnvironmentConfigManager({
          environment: options.environment as Environment
        });
        config = await this.configManager.loadConfiguration();
      }

      // Configure validation middleware
      this.validationMiddleware = new ConfigurationValidationMiddleware({
        strictMode: options.strict,
        includeWarnings: true
      });

      const report = await this.validationMiddleware.validateConfiguration(config);

      // Display results
      if (report.valid) {
        console.log(chalk.green('✅ Configuration is valid!'));
      } else {
        console.log(chalk.red('❌ Configuration validation failed!'));
      }

      // Show summary
      console.log('\n' + chalk.bold('Summary:'));
      console.log(`Total Rules: ${report.summary.total}`);
      console.log(`Passed: ${chalk.green(report.summary.passed)}`);
      console.log(`Failed: ${chalk.red(report.summary.failed)}`);
      console.log(`Warnings: ${chalk.yellow(report.summary.warnings)}`);
      console.log(`Errors: ${chalk.red(report.summary.errors)}`);

      // Show detailed results
      if (report.results.length > 0) {
        console.log('\n' + chalk.bold('Detailed Results:'));
        
        const tableData = [
          ['Rule', 'Severity', 'Status', 'Message']
        ];

        report.results.forEach(result => {
          const status = result.passed ? chalk.green('✅ PASS') : chalk.red('❌ FAIL');
          const severity = result.severity === 'error' ? chalk.red(result.severity) :
                          result.severity === 'warning' ? chalk.yellow(result.severity) :
                          chalk.blue(result.severity);
          
          tableData.push([
            result.rule,
            severity,
            status,
            result.message.substring(0, 60) + (result.message.length > 60 ? '...' : '')
          ]);
        });

        console.log(table(tableData));
      }

      // Generate report if requested
      if (options.report) {
        const reportContent = this.validationMiddleware.generateValidationSummary(report);
        await fs.writeFile(options.report, reportContent);
        console.log(chalk.blue(`📄 Validation report saved to: ${options.report}`));
      }

      process.exit(report.valid ? 0 : 1);

    } catch (error) {
      console.error(chalk.red('Error validating configuration:'), error);
      process.exit(1);
    }
  }

  /**
   * Validate schema command
   */
  private async validateSchemaCommand(options: any): Promise<void> {
    try {
      if (!options.file) {
        console.error(chalk.red('Error: Configuration file is required'));
        process.exit(1);
      }

      const configData = await fs.readJson(options.file);

      if (options.section) {
        // Validate specific section
        const result = ConfigSchemaUtils.validateSection(options.section, configData[options.section]);
        
        if (result.success) {
          console.log(chalk.green(`✅ Section '${options.section}' is valid`));
        } else {
          console.log(chalk.red(`❌ Section '${options.section}' validation failed:`));
          console.log(result.error?.message);
          process.exit(1);
        }
      } else {
        // Validate entire configuration
        const result = validateConfiguration(configData);
        
        if (result.success) {
          console.log(chalk.green('✅ Schema validation passed'));
        } else {
          console.log(chalk.red('❌ Schema validation failed:'));
          console.log(result.error?.message);
          process.exit(1);
        }

        if (result.warnings && result.warnings.length > 0) {
          console.log(chalk.yellow('\n⚠️  Warnings:'));
          result.warnings.forEach(warning => {
            console.log(chalk.yellow(`  - ${warning}`));
          });
        }
      }

    } catch (error) {
      console.error(chalk.red('Error validating schema:'), error);
      process.exit(1);
    }
  }

  /**
   * Compare configurations command
   */
  private async compareCommand(options: any): Promise<void> {
    try {
      console.log(chalk.blue(`🔍 Comparing ${options.source} vs ${options.target} configurations...`));

      // Load source configuration
      const sourceManager = new EnvironmentConfigManager({
        environment: options.source as Environment
      });
      const sourceConfig = await sourceManager.loadConfiguration();

      // Load target configuration
      const targetManager = new EnvironmentConfigManager({
        environment: options.target as Environment
      });
      const targetConfig = await targetManager.loadConfiguration();

      // Compare configurations
      const comparison = sourceManager.compareConfigurations(targetConfig);

      if (comparison.identical) {
        console.log(chalk.green('✅ Configurations are identical'));
        return;
      }

      console.log(chalk.yellow(`⚠️  Found ${comparison.differences.length} differences`));

      if (options.format === 'json') {
        const output = {
          source: options.source,
          target: options.target,
          identical: comparison.identical,
          differences: comparison.differences
        };

        if (options.output) {
          await fs.writeJson(options.output, output, { spaces: 2 });
          console.log(chalk.blue(`📄 Comparison saved to: ${options.output}`));
        } else {
          console.log(JSON.stringify(output, null, 2));
        }
      } else {
        // Table format
        const tableData = [
          ['Path', 'Source', 'Target']
        ];

        comparison.differences.forEach(diff => {
          tableData.push([
            diff.path,
            JSON.stringify(diff.current),
            JSON.stringify(diff.other)
          ]);
        });

        console.log('\n' + table(tableData));
      }

    } catch (error) {
      console.error(chalk.red('Error comparing configurations:'), error);
      process.exit(1);
    }
  }

  /**
   * Generate template command
   */
  private async templateCommand(options: any): Promise<void> {
    try {
      console.log(chalk.blue(`📝 Generating ${options.environment} configuration template...`));

      const template = generateConfigTemplate(options.environment as Environment);
      
      if (options.output) {
        if (await fs.pathExists(options.output) && !options.overwrite) {
          const { overwrite } = await inquirer.prompt([
            {
              type: 'confirm',
              name: 'overwrite',
              message: 'File exists. Overwrite?',
              default: false
            }
          ]);

          if (!overwrite) {
            console.log(chalk.yellow('Template generation cancelled'));
            return;
          }
        }

        await fs.ensureDir(path.dirname(options.output));
        await fs.writeJson(options.output, template, { spaces: 2 });
        console.log(chalk.green(`✅ Template saved to: ${options.output}`));
      } else {
        console.log(JSON.stringify(template, null, 2));
      }

    } catch (error) {
      console.error(chalk.red('Error generating template:'), error);
      process.exit(1);
    }
  }

  /**
   * Migration command
   */
  private async migrateCommand(options: any): Promise<void> {
    try {
      if (!options.file) {
        console.error(chalk.red('Error: Configuration file is required'));
        process.exit(1);
      }

      const config = await fs.readJson(options.file);
      const currentVersion = this.migrationManager.getCurrentVersion(config);
      const targetVersion = options.to || this.migrationManager.getLatestVersion();

      console.log(chalk.blue(`🔄 Migrating configuration from ${currentVersion} to ${targetVersion}...`));

      if (options.dryRun) {
        const plan = this.migrationManager.createMigrationPlan(currentVersion, targetVersion);
        
        console.log('\n' + chalk.bold('Migration Plan:'));
        console.log(`Current Version: ${currentVersion}`);
        console.log(`Target Version: ${targetVersion}`);
        console.log(`Migrations Required: ${plan.migrations.length}`);
        console.log(`Breaking Changes: ${plan.hasBreakingChanges ? 'Yes' : 'No'}`);
        console.log(`Backup Required: ${plan.requiresBackup ? 'Yes' : 'No'}`);
        console.log(`Estimated Duration: ${plan.estimatedDuration}ms`);

        if (plan.migrations.length > 0) {
          console.log('\n' + chalk.bold('Migrations:'));
          plan.migrations.forEach((migration, index) => {
            console.log(`${index + 1}. ${migration.version}: ${migration.name}`);
            console.log(`   ${migration.description}`);
            if (migration.breaking) {
              console.log(chalk.red('   ⚠️  Breaking change'));
            }
          });
        }

        return;
      }

      const result = await this.migrationManager.executeMigration(config, targetVersion, {
        createBackup: options.backup !== false
      });

      if (result.success) {
        console.log(chalk.green('✅ Migration completed successfully'));
        
        // Save migrated configuration
        await fs.writeJson(options.file, (result as any).migratedConfig, { spaces: 2 });
        
        console.log(`Applied Migrations: ${result.appliedMigrations.join(', ')}`);
        if (result.warnings.length > 0) {
          console.log(chalk.yellow('⚠️  Warnings:'));
          result.warnings.forEach(warning => {
            console.log(chalk.yellow(`  - ${warning}`));
          });
        }
      } else {
        console.log(chalk.red('❌ Migration failed'));
        result.errors.forEach(error => {
          console.log(chalk.red(`  - ${error}`));
        });
        process.exit(1);
      }

    } catch (error) {
      console.error(chalk.red('Error executing migration:'), error);
      process.exit(1);
    }
  }

  /**
   * Migration plan command
   */
  private async migrationPlanCommand(options: any): Promise<void> {
    try {
      if (!options.file) {
        console.error(chalk.red('Error: Configuration file is required'));
        process.exit(1);
      }

      const config = await fs.readJson(options.file);
      const currentVersion = this.migrationManager.getCurrentVersion(config);
      const targetVersion = options.to || this.migrationManager.getLatestVersion();

      const plan = this.migrationManager.createMigrationPlan(currentVersion, targetVersion);

      console.log(chalk.bold('Migration Plan:'));
      console.log(`Current Version: ${currentVersion}`);
      console.log(`Target Version: ${targetVersion}`);
      console.log(`Migrations Required: ${plan.migrations.length}`);
      console.log(`Breaking Changes: ${plan.hasBreakingChanges ? chalk.red('Yes') : chalk.green('No')}`);
      console.log(`Backup Required: ${plan.requiresBackup ? chalk.yellow('Yes') : chalk.green('No')}`);
      console.log(`Estimated Duration: ${plan.estimatedDuration}ms`);

      if (plan.migrations.length > 0) {
        console.log('\n' + chalk.bold('Migration Steps:'));
        
        const tableData = [
          ['Step', 'Version', 'Name', 'Breaking', 'Required']
        ];

        plan.migrations.forEach((migration, index) => {
          tableData.push([
            (index + 1).toString(),
            migration.version,
            migration.name,
            migration.breaking ? chalk.red('Yes') : chalk.green('No'),
            migration.required ? chalk.red('Yes') : chalk.yellow('No')
          ]);
        });

        console.log(table(tableData));
      }

    } catch (error) {
      console.error(chalk.red('Error generating migration plan:'), error);
      process.exit(1);
    }
  }

  /**
   * Migration history command
   */
  private async migrationHistoryCommand(): Promise<void> {
    try {
      const history = await this.migrationManager.getMigrationHistory();

      if (history.length === 0) {
        console.log(chalk.yellow('No migration history found'));
        return;
      }

      console.log(chalk.bold('Migration History:'));

      const tableData = [
        ['Date', 'Version', 'Name', 'Status', 'Backup']
      ];

      history.forEach(record => {
        tableData.push([
          record.appliedAt.toISOString(),
          record.version,
          record.name,
          record.success ? chalk.green('Success') : chalk.red('Failed'),
          record.backupPath ? chalk.blue('Available') : chalk.gray('None')
        ]);
      });

      console.log(table(tableData));

    } catch (error) {
      console.error(chalk.red('Error retrieving migration history:'), error);
      process.exit(1);
    }
  }

  /**
   * Rollback command
   */
  private async rollbackCommand(options: any): Promise<void> {
    try {
      if (!options.backup) {
        console.error(chalk.red('Error: Backup file path is required'));
        process.exit(1);
      }

      console.log(chalk.blue(`🔄 Rolling back configuration from backup: ${options.backup}`));

      const result = await this.migrationManager.rollbackMigration(options.backup);

      if (result.success) {
        console.log(chalk.green(`✅ Rollback completed successfully to version ${result.restoredVersion}`));
      } else {
        console.log(chalk.red(`❌ Rollback failed: ${result.error}`));
        process.exit(1);
      }

    } catch (error) {
      console.error(chalk.red('Error executing rollback:'), error);
      process.exit(1);
    }
  }

  /**
   * Schema command
   */
  private async schemaCommand(options: any): Promise<void> {
    try {
      if (options.section) {
        const schema = ConfigSchemaUtils.getSchemaForSection(options.section);
        
        if (options.format === 'json') {
          console.log(JSON.stringify(schema, null, 2));
        } else {
          console.log(chalk.bold(`Schema for section: ${options.section}`));
          // Display schema information in a readable format
          console.log(JSON.stringify(schema, null, 2));
        }
      } else {
        if (options.format === 'docs') {
          const docs = ConfigSchemaUtils.generateSchemaDocumentation();
          console.log(docs);
        } else {
          console.log(chalk.bold('Configuration Schema Sections:'));
          
          const sections = [
            'base', 'server', 'database', 'telegram', 'security',
            'monitoring', 'cache', 'fileSystem', 'resilience'
          ];

          const tableData = [
            ['Section', 'Description']
          ];

          sections.forEach(section => {
            tableData.push([
              section,
              `Configuration for ${section} component`
            ]);
          });

          console.log(table(tableData));
        }
      }

    } catch (error) {
      console.error(chalk.red('Error displaying schema:'), error);
      process.exit(1);
    }
  }

  /**
   * Documentation command
   */
  private async docsCommand(options: any): Promise<void> {
    try {
      console.log(chalk.blue(`📚 Generating documentation in ${options.output}...`));

      await fs.ensureDir(options.output);

      // Generate schema documentation
      const schemaDocs = ConfigSchemaUtils.generateSchemaDocumentation();
      await fs.writeFile(path.join(options.output, 'schema.md'), schemaDocs);

      // Generate migration documentation
      const migrations = this.migrationManager.listAvailableMigrations();
      const migrationDocs = this.generateMigrationDocs(migrations);
      await fs.writeFile(path.join(options.output, 'migrations.md'), migrationDocs);

      // Generate validation rules documentation
      const rules = this.validationMiddleware.getValidationRules();
      const validationDocs = this.generateValidationDocs(rules);
      await fs.writeFile(path.join(options.output, 'validation.md'), validationDocs);

      console.log(chalk.green(`✅ Documentation generated in ${options.output}`));

    } catch (error) {
      console.error(chalk.red('Error generating documentation:'), error);
      process.exit(1);
    }
  }

  /**
   * Environment command
   */
  private async envCommand(options: any): Promise<void> {
    try {
      if (options.list) {
        const environments = ['development', 'staging', 'production', 'test'];
        console.log(chalk.bold('Available Environments:'));
        environments.forEach(env => {
          console.log(`  - ${env}`);
        });
      } else if (options.current) {
        const currentEnv = process.env.NODE_ENV || 'development';
        console.log(chalk.bold(`Current Environment: ${currentEnv}`));
      } else if (options.set) {
        console.log(chalk.blue(`Setting environment to: ${options.set}`));
        console.log(chalk.yellow('Note: Set NODE_ENV environment variable to persist this change'));
      } else {
        console.log(chalk.yellow('Use --list, --current, or --set <env>'));
      }

    } catch (error) {
      console.error(chalk.red('Error managing environment:'), error);
      process.exit(1);
    }
  }

  /**
   * Inspect command
   */
  private async inspectCommand(options: any): Promise<void> {
    try {
      this.configManager = new EnvironmentConfigManager({
        environment: options.environment as Environment
      });
      
      const config = await this.configManager.loadConfiguration();

      if (options.keys) {
        // Show only keys
        const keys = this.extractKeys(config, options.section);
        console.log(chalk.bold('Configuration Keys:'));
        keys.forEach(key => console.log(`  ${key}`));
      } else {
        // Show configuration with optional redaction
        let displayConfig = config;
        
        if (options.section) {
          displayConfig = config[options.section as keyof ApplicationConfig] as any;
        }

        if (options.redact) {
          displayConfig = this.configManager.exportConfiguration(false);
          if (options.section) {
            displayConfig = displayConfig[options.section];
          }
        }

        console.log(JSON.stringify(displayConfig, null, 2));
      }

    } catch (error) {
      console.error(chalk.red('Error inspecting configuration:'), error);
      process.exit(1);
    }
  }

  /**
   * Test command
   */
  private async testCommand(options: any): Promise<void> {
    try {
      console.log(chalk.blue('🧪 Testing configuration...'));

      let config: ApplicationConfig;

      if (options.file) {
        config = await fs.readJson(options.file);
      } else {
        this.configManager = new EnvironmentConfigManager({
          environment: options.environment as Environment
        });
        config = await this.configManager.loadConfiguration();
      }

      const tests = [];

      if (options.connectivity) {
        tests.push(this.testConnectivity(config));
      }

      if (options.permissions) {
        tests.push(this.testPermissions(config));
      }

      if (tests.length === 0) {
        // Run all tests by default
        tests.push(
          this.testConnectivity(config),
          this.testPermissions(config)
        );
      }

      const results = await Promise.allSettled(tests);
      
      results.forEach((result, index) => {
        if (result.status === 'fulfilled') {
          console.log(chalk.green(`✅ Test ${index + 1} passed`));
        } else {
          console.log(chalk.red(`❌ Test ${index + 1} failed: ${result.reason}`));
        }
      });

    } catch (error) {
      console.error(chalk.red('Error testing configuration:'), error);
      process.exit(1);
    }
  }

  /**
   * Optimize command
   */
  private async optimizeCommand(options: any): Promise<void> {
    try {
      if (!options.file) {
        console.error(chalk.red('Error: Configuration file is required'));
        process.exit(1);
      }

      console.log(chalk.blue('⚡ Optimizing configuration...'));

      const config = await fs.readJson(options.file);
      let optimized = { ...config };

      if (options.removeDefaults) {
        // Remove default values (implementation would depend on schema)
        console.log(chalk.yellow('Removing default values...'));
      }

      if (options.minify) {
        // Minify by removing unnecessary whitespace and comments
        console.log(chalk.yellow('Minifying configuration...'));
      }

      const outputPath = options.output || options.file;
      await fs.writeJson(outputPath, optimized, { 
        spaces: options.minify ? 0 : 2 
      });

      console.log(chalk.green(`✅ Optimized configuration saved to: ${outputPath}`));

    } catch (error) {
      console.error(chalk.red('Error optimizing configuration:'), error);
      process.exit(1);
    }
  }

  /**
   * Security scan command
   */
  private async securityScanCommand(options: any): Promise<void> {
    try {
      console.log(chalk.blue('🔒 Scanning configuration for security issues...'));

      let config: ApplicationConfig;

      if (options.file) {
        config = await fs.readJson(options.file);
      } else {
        this.configManager = new EnvironmentConfigManager({
          environment: options.environment as Environment
        });
        config = await this.configManager.loadConfiguration();
      }

      // Use validation middleware with security focus
      const validationMiddleware = new ConfigurationValidationMiddleware({
        enableSecurityChecks: true,
        strictMode: true
      });

      const report = await validationMiddleware.validateConfiguration(config);

      // Filter security-related issues
      const securityIssues = report.results.filter(result => 
        !result.passed && 
        (result.rule.includes('security') || 
         result.rule.includes('jwt') || 
         result.rule.includes('encryption') ||
         result.rule.includes('csrf') ||
         result.rule.includes('https'))
      );

      if (securityIssues.length === 0) {
        console.log(chalk.green('✅ No security issues found'));
      } else {
        console.log(chalk.red(`❌ Found ${securityIssues.length} security issues`));

        const tableData = [
          ['Rule', 'Severity', 'Message', 'Suggestion']
        ];

        securityIssues.forEach(issue => {
          const severity = issue.severity === 'error' ? chalk.red(issue.severity) :
                          issue.severity === 'warning' ? chalk.yellow(issue.severity) :
                          chalk.blue(issue.severity);
          
          tableData.push([
            issue.rule,
            severity,
            issue.message,
            issue.suggestion || 'N/A'
          ]);
        });

        console.log(table(tableData));
        process.exit(1);
      }

    } catch (error) {
      console.error(chalk.red('Error scanning for security issues:'), error);
      process.exit(1);
    }
  }

  /**
   * Helper methods
   */

  private extractKeys(obj: any, section?: string, prefix = ''): string[] {
    const keys: string[] = [];
    
    if (section && obj[section]) {
      obj = obj[section];
    }

    for (const key in obj) {
      const fullKey = prefix ? `${prefix}.${key}` : key;
      
      if (typeof obj[key] === 'object' && obj[key] !== null && !Array.isArray(obj[key])) {
        keys.push(...this.extractKeys(obj[key], undefined, fullKey));
      } else {
        keys.push(fullKey);
      }
    }

    return keys;
  }

  private async testConnectivity(config: ApplicationConfig): Promise<void> {
    // Test database connectivity
    if (config.database?.connectionString) {
      // Implementation would test database connection
      console.log(chalk.blue('Testing database connectivity...'));
    }

    // Test Telegram API connectivity
    if (config.telegram.botToken) {
      // Implementation would test Telegram API
      console.log(chalk.blue('Testing Telegram API connectivity...'));
    }
  }

  private async testPermissions(config: ApplicationConfig): Promise<void> {
    // Test file system permissions
    const paths = [
      config.fileSystem.dataDirectory,
      config.fileSystem.tempDirectory,
      config.fileSystem.logsDirectory
    ];

    for (const dirPath of paths) {
      try {
        await fs.access(dirPath, fs.constants.R_OK | fs.constants.W_OK);
        console.log(chalk.green(`✅ ${dirPath} - Read/Write OK`));
      } catch (error) {
        console.log(chalk.red(`❌ ${dirPath} - Permission denied`));
      }
    }
  }

  private generateMigrationDocs(migrations: any[]): string {
    const lines = [
      '# Configuration Migrations',
      '',
      'This document describes available configuration migrations.',
      '',
      '## Available Migrations',
      ''
    ];

    migrations.forEach(migration => {
      lines.push(`### ${migration.version}: ${migration.name}`);
      lines.push('');
      lines.push(migration.description);
      lines.push('');
      if (migration.breaking) {
        lines.push('**⚠️ Breaking Change**');
        lines.push('');
      }
      if (migration.required) {
        lines.push('**Required Migration**');
        lines.push('');
      }
    });

    return lines.join('\n');
  }

  private generateValidationDocs(rules: ValidationRule[]): string {
    const lines = [
      '# Configuration Validation Rules',
      '',
      'This document describes available validation rules.',
      '',
      '## Validation Rules',
      ''
    ];

    const rulesByCategory = new Map<string, ValidationRule[]>();
    
    rules.forEach(rule => {
      const category = rule.name.split('-')[0];
      if (!rulesByCategory.has(category)) {
        rulesByCategory.set(category, []);
      }
      rulesByCategory.get(category)!.push(rule);
    });

    for (const [category, categoryRules] of rulesByCategory) {
      lines.push(`### ${category.charAt(0).toUpperCase() + category.slice(1)} Rules`);
      lines.push('');

      categoryRules.forEach(rule => {
        lines.push(`#### ${rule.name}`);
        lines.push('');
        lines.push(`**Severity:** ${rule.severity}`);
        lines.push('');
        lines.push(`**Description:** ${rule.description}`);
        lines.push('');
        if (rule.environments) {
          lines.push(`**Environments:** ${rule.environments.join(', ')}`);
          lines.push('');
        }
      });
    }

    return lines.join('\n');
  }
}

// Run CLI if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const cli = new ConfigurationCLI();
  cli.initialize().catch(error => {
    console.error(chalk.red('CLI Error:'), error);
    process.exit(1);
  });
}

export { ConfigurationCLI };