#!/usr/bin/env node

/**
 * CCTelegram Communication Agent
 * Specialized agent for automated status updates and progress tracking
 * 
 * Features:
 * - Automated task progress updates
 * - Real-time status monitoring
 * - Smart notification scheduling
 * - Context-aware messaging
 * - Integration with project management tools
 */

const fs = require('fs').promises;
const path = require('path');
const { execSync } = require('child_process');

class CCTelegramAgent {
    constructor(config = {}) {
        this.config = {
            updateInterval: config.updateInterval || 300000, // 5 minutes
            progressThreshold: config.progressThreshold || 0.1, // 10% progress change
            maxMessagesPerHour: config.maxMessagesPerHour || 12,
            workingHours: config.workingHours || { start: 9, end: 18 }, // 9 AM - 6 PM
            projectRoot: config.projectRoot || process.cwd(),
            ...config
        };
        
        this.state = {
            lastUpdate: null,
            currentTasks: new Map(),
            messageCount: 0,
            lastHourReset: Date.now()
        };
        
        this.mcpServerUrl = process.env.MCP_SERVER_URL || 'http://localhost:3000';
        this.isActive = false;
    }

    /**
     * Start the CCTelegram agent
     */
    async start() {
        console.log('🤖 Starting CCTelegram Agent...');
        console.log(`📡 Monitoring project: ${this.config.projectRoot}`);
        console.log(`⏰ Update interval: ${this.config.updateInterval / 1000}s`);
        
        this.isActive = true;
        
        // Send startup notification
        await this.sendMessage('🚀 CCTelegram Agent Started', 
            'Monitoring system activated. Will provide automated updates on project progress.');
        
        // Start monitoring loops
        this.startTaskMonitoring();
        this.startProgressTracking();
        this.startHealthMonitoring();
        
        // Setup graceful shutdown
        process.on('SIGINT', () => this.shutdown());
        process.on('SIGTERM', () => this.shutdown());
    }

    /**
     * Task monitoring - tracks development tasks and milestones
     */
    startTaskMonitoring() {
        setInterval(async () => {
            if (!this.isActive) return;
            
            try {
                // Check for Task Master tasks if available
                const taskMasterTasks = await this.getTaskMasterStatus();
                if (taskMasterTasks) {
                    await this.processTaskMasterUpdates(taskMasterTasks);
                }
                
                // Check for git activity
                const gitActivity = await this.getGitActivity();
                if (gitActivity.newCommits > 0) {
                    await this.reportGitActivity(gitActivity);
                }
                
                // Check for build/deployment activities
                const buildStatus = await this.checkBuildStatus();
                if (buildStatus.hasUpdates) {
                    await this.reportBuildStatus(buildStatus);
                }
                
            } catch (error) {
                console.error('❌ Task monitoring error:', error.message);
            }
        }, this.config.updateInterval);
    }

    /**
     * Progress tracking - monitors overall project progress
     */
    startProgressTracking() {
        setInterval(async () => {
            if (!this.isActive || !this.shouldSendUpdate()) return;
            
            try {
                const progress = await this.calculateProjectProgress();
                
                if (this.shouldReportProgress(progress)) {
                    await this.sendProgressUpdate(progress);
                }
                
            } catch (error) {
                console.error('❌ Progress tracking error:', error.message);
            }
        }, this.config.updateInterval * 2); // Less frequent than task monitoring
    }

    /**
     * Health monitoring - system status and performance
     */
    startHealthMonitoring() {
        setInterval(async () => {
            if (!this.isActive) return;
            
            try {
                const health = await this.checkSystemHealth();
                
                if (health.alerts.length > 0) {
                    await this.sendHealthAlert(health);
                }
                
            } catch (error) {
                console.error('❌ Health monitoring error:', error.message);
            }
        }, this.config.updateInterval / 2); // More frequent for health
    }

    /**
     * Get Task Master status if available
     */
    async getTaskMasterStatus() {
        try {
            const tasksPath = path.join(this.config.projectRoot, '.taskmaster', 'tasks', 'tasks.json');
            const tasksContent = await fs.readFile(tasksPath, 'utf8');
            const tasksData = JSON.parse(tasksContent);
            
            return {
                totalTasks: tasksData.tasks?.length || 0,
                completedTasks: tasksData.tasks?.filter(t => t.status === 'done').length || 0,
                inProgressTasks: tasksData.tasks?.filter(t => t.status === 'in-progress').length || 0,
                pendingTasks: tasksData.tasks?.filter(t => t.status === 'pending').length || 0,
                lastModified: (await fs.stat(tasksPath)).mtime
            };
        } catch (error) {
            return null; // Task Master not available
        }
    }

    /**
     * Process Task Master updates
     */
    async processTaskMasterUpdates(tasks) {
        const taskKey = 'taskmaster';
        const lastTasks = this.state.currentTasks.get(taskKey);
        
        if (!lastTasks) {
            // First time seeing Task Master data
            this.state.currentTasks.set(taskKey, tasks);
            
            if (tasks.totalTasks > 0) {
                const completionRate = (tasks.completedTasks / tasks.totalTasks * 100).toFixed(1);
                await this.sendMessage('📋 Task Master Status', 
                    `Project tracking initialized:\n` +
                    `• Total tasks: ${tasks.totalTasks}\n` +
                    `• Completed: ${tasks.completedTasks} (${completionRate}%)\n` +
                    `• In progress: ${tasks.inProgressTasks}\n` +
                    `• Pending: ${tasks.pendingTasks}`);
            }
            return;
        }
        
        // Check for task completions
        const newCompletions = tasks.completedTasks - lastTasks.completedTasks;
        if (newCompletions > 0) {
            const completionRate = (tasks.completedTasks / tasks.totalTasks * 100).toFixed(1);
            await this.sendMessage('✅ Task Progress Update', 
                `${newCompletions} task${newCompletions > 1 ? 's' : ''} completed!\n` +
                `• Progress: ${completionRate}% (${tasks.completedTasks}/${tasks.totalTasks})\n` +
                `• In progress: ${tasks.inProgressTasks}\n` +
                `• Remaining: ${tasks.pendingTasks}`);
        }
        
        // Check for new tasks starting
        const newInProgress = tasks.inProgressTasks - lastTasks.inProgressTasks;
        if (newInProgress > 0) {
            await this.sendMessage('🔄 Task Activity', 
                `${newInProgress} new task${newInProgress > 1 ? 's' : ''} started`);
        }
        
        this.state.currentTasks.set(taskKey, tasks);
    }

    /**
     * Get recent git activity
     */
    async getGitActivity() {
        try {
            const since = this.state.lastUpdate || new Date(Date.now() - this.config.updateInterval);
            const sinceStr = since.toISOString().split('T')[0];
            
            const commits = execSync(`git log --since="${sinceStr}" --oneline --no-merges`, {
                cwd: this.config.projectRoot,
                encoding: 'utf8'
            }).trim();
            
            const commitLines = commits ? commits.split('\n') : [];
            
            return {
                newCommits: commitLines.length,
                commits: commitLines.slice(0, 5), // Last 5 commits
                branch: execSync('git branch --show-current', {
                    cwd: this.config.projectRoot,
                    encoding: 'utf8'
                }).trim()
            };
        } catch (error) {
            return { newCommits: 0, commits: [], branch: 'unknown' };
        }
    }

    /**
     * Report git activity
     */
    async reportGitActivity(activity) {
        if (activity.newCommits === 0) return;
        
        const commitList = activity.commits
            .map(commit => `• ${commit}`)
            .join('\n');
        
        await this.sendMessage(`📝 Git Activity (${activity.branch})`, 
            `${activity.newCommits} new commit${activity.newCommits > 1 ? 's' : ''}:\n\n${commitList}`);
    }

    /**
     * Check build status
     */
    async checkBuildStatus() {
        try {
            // Check for package.json changes
            const packagePath = path.join(this.config.projectRoot, 'package.json');
            const cargoPath = path.join(this.config.projectRoot, 'Cargo.toml');
            
            const updates = [];
            
            // Check Node.js project
            try {
                const packageStat = await fs.stat(packagePath);
                const packageModified = packageStat.mtime > (this.state.lastUpdate || 0);
                if (packageModified) {
                    updates.push({ type: 'npm', file: 'package.json' });
                }
            } catch (e) { /* Package.json doesn't exist */ }
            
            // Check Rust project
            try {
                const cargoStat = await fs.stat(cargoPath);
                const cargoModified = cargoStat.mtime > (this.state.lastUpdate || 0);
                if (cargoModified) {
                    updates.push({ type: 'cargo', file: 'Cargo.toml' });
                }
            } catch (e) { /* Cargo.toml doesn't exist */ }
            
            return {
                hasUpdates: updates.length > 0,
                updates
            };
        } catch (error) {
            return { hasUpdates: false, updates: [] };
        }
    }

    /**
     * Report build status
     */
    async reportBuildStatus(status) {
        const updateTypes = status.updates.map(u => u.type).join(', ');
        await this.sendMessage('🔨 Build Dependencies Updated', 
            `Dependency changes detected in: ${updateTypes}\n` +
            'Consider running build/update commands if needed.');
    }

    /**
     * Calculate project progress
     */
    async calculateProjectProgress() {
        const progress = {
            timestamp: new Date(),
            metrics: {}
        };
        
        // File-based progress indicators
        try {
            const srcFiles = await this.countFiles(path.join(this.config.projectRoot, 'src'), ['.rs', '.ts', '.js']);
            const testFiles = await this.countFiles(this.config.projectRoot, ['.test.js', '.test.ts', '_test.rs']);
            const docFiles = await this.countFiles(path.join(this.config.projectRoot, 'docs'), ['.md']);
            
            progress.metrics = {
                sourceFiles: srcFiles,
                testFiles: testFiles,
                documentationFiles: docFiles,
                testCoverage: testFiles / Math.max(srcFiles, 1) * 100
            };
        } catch (error) {
            console.error('❌ Error calculating progress:', error.message);
        }
        
        return progress;
    }

    /**
     * Count files with specific extensions
     */
    async countFiles(dir, extensions) {
        try {
            const files = await fs.readdir(dir, { recursive: true });
            return files.filter(file => 
                extensions.some(ext => file.endsWith(ext))
            ).length;
        } catch (error) {
            return 0;
        }
    }

    /**
     * Check if progress should be reported
     */
    shouldReportProgress(progress) {
        const lastProgress = this.state.currentTasks.get('progress');
        if (!lastProgress) {
            this.state.currentTasks.set('progress', progress);
            return false; // Don't report initial state
        }
        
        // Check for significant changes
        const sourceChange = Math.abs(progress.metrics.sourceFiles - lastProgress.metrics.sourceFiles);
        const docChange = Math.abs(progress.metrics.documentationFiles - lastProgress.metrics.documentationFiles);
        
        const significantChange = sourceChange >= 5 || docChange >= 3;
        
        if (significantChange) {
            this.state.currentTasks.set('progress', progress);
            return true;
        }
        
        return false;
    }

    /**
     * Send progress update
     */
    async sendProgressUpdate(progress) {
        const m = progress.metrics;
        const testCoverageText = m.testCoverage > 0 ? ` (${m.testCoverage.toFixed(1)}% coverage)` : '';
        
        await this.sendMessage('📊 Project Progress Update', 
            `Development metrics:\n` +
            `• Source files: ${m.sourceFiles}\n` +
            `• Test files: ${m.testFiles}${testCoverageText}\n` +
            `• Documentation: ${m.documentationFiles} files\n\n` +
            `Keep up the great work! 🚀`);
    }

    /**
     * Check system health
     */
    async checkSystemHealth() {
        const alerts = [];
        
        try {
            // Check if CCTelegram bridge is running (if applicable)
            try {
                const response = await fetch('http://localhost:8080/health');
                if (!response.ok) {
                    alerts.push({
                        type: 'warning',
                        message: 'CCTelegram Bridge health check failed'
                    });
                }
            } catch (error) {
                // Bridge not running, which is fine if not deployed
            }
            
            // Check disk space
            try {
                const diskUsage = execSync('df -h /', { encoding: 'utf8' });
                const usageMatch = diskUsage.match(/(\d+)%/);
                if (usageMatch && parseInt(usageMatch[1]) > 85) {
                    alerts.push({
                        type: 'critical',
                        message: `Disk usage high: ${usageMatch[1]}%`
                    });
                }
            } catch (error) {
                // Can't check disk usage
            }
            
        } catch (error) {
            alerts.push({
                type: 'error',
                message: `Health check error: ${error.message}`
            });
        }
        
        return { alerts };
    }

    /**
     * Send health alert
     */
    async sendHealthAlert(health) {
        const criticalAlerts = health.alerts.filter(a => a.type === 'critical');
        const warningAlerts = health.alerts.filter(a => a.type === 'warning');
        
        if (criticalAlerts.length > 0) {
            const alertText = criticalAlerts.map(a => `• ${a.message}`).join('\n');
            await this.sendMessage('🚨 Critical System Alert', 
                `Critical issues detected:\n${alertText}\n\nImmediate attention required!`);
        } else if (warningAlerts.length > 0 && this.shouldSendWarning()) {
            const alertText = warningAlerts.map(a => `• ${a.message}`).join('\n');
            await this.sendMessage('⚠️ System Warning', 
                `Warning conditions detected:\n${alertText}`);
        }
    }

    /**
     * Check if we should send updates (rate limiting and working hours)
     */
    shouldSendUpdate() {
        const now = new Date();
        const hour = now.getHours();
        
        // Check working hours
        if (hour < this.config.workingHours.start || hour > this.config.workingHours.end) {
            return false;
        }
        
        // Check rate limiting
        if (Date.now() - this.state.lastHourReset > 3600000) {
            this.state.messageCount = 0;
            this.state.lastHourReset = Date.now();
        }
        
        return this.state.messageCount < this.config.maxMessagesPerHour;
    }

    /**
     * Check if we should send warning (less frequent than regular updates)
     */
    shouldSendWarning() {
        const lastWarning = this.state.currentTasks.get('lastWarning') || 0;
        const warningCooldown = 3600000; // 1 hour
        
        return Date.now() - lastWarning > warningCooldown;
    }

    /**
     * Send message via CCTelegram
     */
    async sendMessage(title, description, type = 'info_notification') {
        if (!this.shouldSendUpdate() && type !== 'critical') {
            console.log(`⏭️ Skipping message (rate limited): ${title}`);
            return;
        }
        
        try {
            const response = await fetch(`${this.mcpServerUrl}/mcp/send_telegram_message`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    type,
                    title,
                    description,
                    source: 'cctelegram-agent'
                })
            });
            
            if (response.ok) {
                console.log(`✅ Sent: ${title}`);
                this.state.messageCount++;
                this.state.lastUpdate = new Date();
                
                if (type === 'warning') {
                    this.state.currentTasks.set('lastWarning', Date.now());
                }
            } else {
                console.error(`❌ Failed to send message: ${response.status} ${response.statusText}`);
            }
            
        } catch (error) {
            console.error('❌ Communication error:', error.message);
        }
    }

    /**
     * Shutdown the agent gracefully
     */
    async shutdown() {
        console.log('🛑 Shutting down CCTelegram Agent...');
        this.isActive = false;
        
        await this.sendMessage('🛑 CCTelegram Agent Stopped', 
            'Agent monitoring has been deactivated. No further automated updates will be sent.');
        
        process.exit(0);
    }
}

// CLI Interface
if (require.main === module) {
    const config = {
        projectRoot: process.argv[2] || process.cwd(),
        updateInterval: parseInt(process.argv[3]) || 300000,
        maxMessagesPerHour: parseInt(process.argv[4]) || 12
    };
    
    const agent = new CCTelegramAgent(config);
    
    console.log('🤖 CCTelegram Agent v1.0');
    console.log('Usage: node cctelegram-agent.js [projectRoot] [updateInterval] [maxMessagesPerHour]');
    console.log('');
    
    agent.start().catch(error => {
        console.error('💥 Agent startup failed:', error);
        process.exit(1);
    });
}

module.exports = CCTelegramAgent;