/**
 * Resource Utilization Monitoring System for Performance Testing
 * 
 * Monitors CPU, memory, disk I/O, network, and system resources during
 * performance tests to correlate resource usage with performance metrics
 */

import { EventEmitter } from 'events';
import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';
import pidusage from 'pidusage';
import si from 'systeminformation';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface ResourceSnapshot {
  timestamp: number;
  system: {
    cpu: {
      usage: number; // Overall CPU usage percentage
      loadAvg: number[]; // 1, 5, 15 minute load averages
      cores: number;
      speed: number; // CPU speed in GHz
      temperature?: number; // CPU temperature if available
    };
    memory: {
      total: number; // Total RAM in bytes
      used: number; // Used RAM in bytes
      available: number; // Available RAM in bytes
      usage: number; // Usage percentage
      cached: number; // Cached memory in bytes
      buffers: number; // Buffer memory in bytes
      swapTotal: number; // Total swap in bytes
      swapUsed: number; // Used swap in bytes
    };
    disk: {
      reads: number; // Disk reads per second
      writes: number; // Disk writes per second
      readBytes: number; // Bytes read per second
      writeBytes: number; // Bytes written per second
      usage: number; // Disk usage percentage
      available: number; // Available disk space in bytes
      ioWait: number; // IO wait percentage
    };
    network: {
      rx: number; // Bytes received per second
      tx: number; // Bytes transmitted per second
      rxPackets: number; // Packets received per second
      txPackets: number; // Packets transmitted per second
      errors: number; // Network errors
      dropped: number; // Dropped packets
    };
  };
  process?: {
    pid: number;
    cpu: number; // Process CPU usage percentage
    memory: number; // Process memory usage in bytes
    memoryPercent: number; // Process memory usage percentage
    threads: number; // Number of threads
    handles: number; // File handles (Windows)
    uptime: number; // Process uptime in seconds
  };
}

export interface ResourceThresholds {
  cpu: {
    warning: number; // CPU usage warning threshold (%)
    critical: number; // CPU usage critical threshold (%)
  };
  memory: {
    warning: number; // Memory usage warning threshold (%)
    critical: number; // Memory usage critical threshold (%)
  };
  disk: {
    usageWarning: number; // Disk usage warning threshold (%)
    usageCritical: number; // Disk usage critical threshold (%)
    ioWaitWarning: number; // IO wait warning threshold (%)
    ioWaitCritical: number; // IO wait critical threshold (%)
  };
  network: {
    errorRateWarning: number; // Network error rate warning (errors/sec)
    errorRateCritical: number; // Network error rate critical (errors/sec)
  };
}

export interface ResourceAlert {
  timestamp: number;
  type: 'warning' | 'critical';
  resource: 'cpu' | 'memory' | 'disk' | 'network' | 'process';
  metric: string;
  current: number;
  threshold: number;
  message: string;
  impact: 'low' | 'medium' | 'high';
}

export interface MonitoringSession {
  sessionId: string;
  startTime: number;
  endTime?: number;
  duration?: number;
  snapshots: ResourceSnapshot[];
  alerts: ResourceAlert[];
  summary: {
    avgCpu: number;
    maxCpu: number;
    avgMemory: number;
    maxMemory: number;
    avgDiskIo: number;
    maxDiskIo: number;
    avgNetworkRx: number;
    avgNetworkTx: number;
    totalAlerts: number;
    criticalAlerts: number;
  };
  processStats?: {
    pid: number;
    avgCpu: number;
    maxCpu: number;
    avgMemory: number;
    maxMemory: number;
    peakThreads: number;
  };
}

export interface MonitoringConfig {
  interval: number; // Monitoring interval in milliseconds
  processPid?: number; // Specific process to monitor
  outputDir: string; // Directory to save monitoring data
  thresholds: ResourceThresholds;
  enableAlerts: boolean;
  enableProcessMonitoring: boolean;
  maxSnapshots: number; // Maximum snapshots to keep in memory
}

/**
 * Resource Utilization Monitor
 */
export class ResourceMonitor extends EventEmitter {
  private config: MonitoringConfig;
  private isMonitoring: boolean = false;
  private monitoringTimer?: NodeJS.Timeout;
  private currentSession?: MonitoringSession;
  private previousNetworkStats?: any;
  private previousDiskStats?: any;
  
  constructor(config: Partial<MonitoringConfig> = {}) {
    super();
    
    this.config = {
      interval: 5000, // 5 seconds default
      outputDir: path.join(__dirname, '..', '..', 'reports', 'resource-monitoring'),
      thresholds: {
        cpu: { warning: 70, critical: 85 },
        memory: { warning: 80, critical: 90 },
        disk: { 
          usageWarning: 85, 
          usageCritical: 95, 
          ioWaitWarning: 10, 
          ioWaitCritical: 20 
        },
        network: { 
          errorRateWarning: 10, 
          errorRateCritical: 50 
        }
      },
      enableAlerts: true,
      enableProcessMonitoring: false,
      maxSnapshots: 1000,
      ...config
    };
  }

  /**
   * Start monitoring resources
   */
  public async startMonitoring(sessionId?: string): Promise<string> {
    if (this.isMonitoring) {
      throw new Error('Monitoring is already running');
    }

    const id = sessionId || `resource-monitor-${Date.now()}`;
    
    this.currentSession = {
      sessionId: id,
      startTime: Date.now(),
      snapshots: [],
      alerts: [],
      summary: {
        avgCpu: 0,
        maxCpu: 0,
        avgMemory: 0,
        maxMemory: 0,
        avgDiskIo: 0,
        maxDiskIo: 0,
        avgNetworkRx: 0,
        avgNetworkTx: 0,
        totalAlerts: 0,
        criticalAlerts: 0
      }
    };

    if (this.config.enableProcessMonitoring && this.config.processPid) {
      this.currentSession.processStats = {
        pid: this.config.processPid,
        avgCpu: 0,
        maxCpu: 0,
        avgMemory: 0,
        maxMemory: 0,
        peakThreads: 0
      };
    }

    this.isMonitoring = true;
    
    // Ensure output directory exists
    await fs.ensureDir(this.config.outputDir);
    
    // Take initial baseline measurements
    await this.takeMeasurements();
    
    // Start periodic monitoring
    this.monitoringTimer = setInterval(async () => {
      try {
        await this.takeMeasurements();
      } catch (error) {
        console.error('Error taking measurements:', error);
        this.emit('error', error);
      }
    }, this.config.interval);

    console.log(`Resource monitoring started (Session: ${id})`);
    this.emit('monitoringStarted', { sessionId: id });
    
    return id;
  }

  /**
   * Stop monitoring and generate summary
   */
  public async stopMonitoring(): Promise<MonitoringSession | null> {
    if (!this.isMonitoring || !this.currentSession) {
      return null;
    }

    this.isMonitoring = false;
    
    if (this.monitoringTimer) {
      clearInterval(this.monitoringTimer);
      this.monitoringTimer = undefined;
    }

    // Take final measurement
    await this.takeMeasurements();
    
    // Finalize session
    this.currentSession.endTime = Date.now();
    this.currentSession.duration = this.currentSession.endTime - this.currentSession.startTime;
    
    // Generate summary statistics
    this.generateSummary();
    
    // Save session data
    await this.saveSession(this.currentSession);
    
    const session = this.currentSession;
    this.currentSession = undefined;
    
    console.log(`Resource monitoring stopped (Duration: ${(session.duration! / 1000).toFixed(1)}s)`);
    this.emit('monitoringStopped', session);
    
    return session;
  }

  /**
   * Take resource measurements
   */
  private async takeMeasurements(): Promise<void> {
    if (!this.currentSession) return;

    const timestamp = Date.now();
    
    try {
      // Get system information
      const [
        cpuLoad,
        cpuCurrentSpeed,
        memoryInfo,
        diskLayout,
        diskIO,
        networkInterfaces,
        networkStats,
        cpuTemp
      ] = await Promise.all([
        si.currentLoad(),
        si.cpuCurrentSpeed(),
        si.mem(),
        si.diskLayout(),
        si.disksIO(),
        si.networkInterfaces(),
        si.networkStats(),
        si.cpuTemperature().catch(() => null) // Temperature might not be available
      ]);

      // Process monitoring if enabled
      let processInfo = undefined;
      if (this.config.enableProcessMonitoring && this.config.processPid) {
        try {
          const processStats = await pidusage(this.config.processPid);
          processInfo = {
            pid: this.config.processPid,
            cpu: processStats.cpu,
            memory: processStats.memory,
            memoryPercent: (processStats.memory / memoryInfo.total) * 100,
            threads: processStats.ctime || 0,
            handles: 0, // pidusage doesn't provide handles
            uptime: processStats.elapsed / 1000
          };
        } catch (error) {
          console.warn(`Failed to get process stats for PID ${this.config.processPid}:`, error);
        }
      }

      // Calculate network deltas
      const networkRx = networkStats.reduce((sum, iface) => sum + (iface.rx_bytes || 0), 0);
      const networkTx = networkStats.reduce((sum, iface) => sum + (iface.tx_bytes || 0), 0);
      const networkRxPackets = networkStats.reduce((sum, iface) => sum + (iface.rx_packets || 0), 0);
      const networkTxPackets = networkStats.reduce((sum, iface) => sum + (iface.tx_packets || 0), 0);
      const networkErrors = networkStats.reduce((sum, iface) => sum + (iface.rx_errors || 0) + (iface.tx_errors || 0), 0);
      const networkDropped = networkStats.reduce((sum, iface) => sum + (iface.rx_dropped || 0) + (iface.tx_dropped || 0), 0);

      let networkRxRate = 0, networkTxRate = 0, networkRxPacketRate = 0, networkTxPacketRate = 0;
      if (this.previousNetworkStats) {
        const timeDelta = (timestamp - this.previousNetworkStats.timestamp) / 1000;
        networkRxRate = Math.max(0, (networkRx - this.previousNetworkStats.rx) / timeDelta);
        networkTxRate = Math.max(0, (networkTx - this.previousNetworkStats.tx) / timeDelta);
        networkRxPacketRate = Math.max(0, (networkRxPackets - this.previousNetworkStats.rxPackets) / timeDelta);
        networkTxPacketRate = Math.max(0, (networkTxPackets - this.previousNetworkStats.txPackets) / timeDelta);
      }
      this.previousNetworkStats = { timestamp, rx: networkRx, tx: networkTx, rxPackets: networkRxPackets, txPackets: networkTxPackets };

      // Calculate disk I/O rates
      let diskReadRate = diskIO.rIO || 0;
      let diskWriteRate = diskIO.wIO || 0;
      let diskReadBytesRate = diskIO.rIO_sec || 0;
      let diskWriteBytesRate = diskIO.wIO_sec || 0;
      
      if (this.previousDiskStats) {
        const timeDelta = (timestamp - this.previousDiskStats.timestamp) / 1000;
        diskReadRate = Math.max(0, ((diskIO.rIO || 0) - this.previousDiskStats.reads) / timeDelta);
        diskWriteRate = Math.max(0, ((diskIO.wIO || 0) - this.previousDiskStats.writes) / timeDelta);
        diskReadBytesRate = Math.max(0, ((diskIO.rIO_sec || 0) - this.previousDiskStats.readBytes) / timeDelta);
        diskWriteBytesRate = Math.max(0, ((diskIO.wIO_sec || 0) - this.previousDiskStats.writeBytes) / timeDelta);
      }
      this.previousDiskStats = { 
        timestamp, 
        reads: diskIO.rIO || 0, 
        writes: diskIO.wIO || 0, 
        readBytes: diskIO.rIO_sec || 0, 
        writeBytes: diskIO.wIO_sec || 0 
      };

      // Get disk usage
      const diskUsage = diskLayout.length > 0 ? 
        ((diskLayout[0].size - (diskLayout[0].size * 0.9)) / diskLayout[0].size) * 100 : 0; // Approximate
      const diskAvailable = diskLayout.length > 0 ? diskLayout[0].size * 0.9 : 0;

      // Create resource snapshot
      const snapshot: ResourceSnapshot = {
        timestamp,
        system: {
          cpu: {
            usage: cpuLoad.currentLoad,
            loadAvg: cpuLoad.avgLoad ? [cpuLoad.avgLoad] : [0],
            cores: cpuLoad.cpus?.length || 1,
            speed: cpuCurrentSpeed.avg || 0,
            temperature: cpuTemp?.main || undefined
          },
          memory: {
            total: memoryInfo.total,
            used: memoryInfo.used,
            available: memoryInfo.available,
            usage: (memoryInfo.used / memoryInfo.total) * 100,
            cached: memoryInfo.cached || 0,
            buffers: memoryInfo.buffers || 0,
            swapTotal: memoryInfo.swaptotal,
            swapUsed: memoryInfo.swapused
          },
          disk: {
            reads: diskReadRate,
            writes: diskWriteRate,
            readBytes: diskReadBytesRate,
            writeBytes: diskWriteBytesRate,
            usage: diskUsage,
            available: diskAvailable,
            ioWait: cpuLoad.iowait || 0
          },
          network: {
            rx: networkRxRate,
            tx: networkTxRate,
            rxPackets: networkRxPacketRate,
            txPackets: networkTxPacketRate,
            errors: networkErrors,
            dropped: networkDropped
          }
        },
        process: processInfo
      };

      // Add snapshot to session
      this.currentSession.snapshots.push(snapshot);
      
      // Limit snapshots in memory
      if (this.currentSession.snapshots.length > this.config.maxSnapshots) {
        this.currentSession.snapshots = this.currentSession.snapshots.slice(-this.config.maxSnapshots);
      }

      // Check thresholds and generate alerts
      if (this.config.enableAlerts) {
        this.checkThresholds(snapshot);
      }

      this.emit('snapshot', snapshot);

    } catch (error) {
      console.error('Error collecting system information:', error);
      this.emit('error', error);
    }
  }

  /**
   * Check resource thresholds and generate alerts
   */
  private checkThresholds(snapshot: ResourceSnapshot): void {
    if (!this.currentSession) return;

    const alerts: ResourceAlert[] = [];

    // CPU threshold checks
    if (snapshot.system.cpu.usage > this.config.thresholds.cpu.critical) {
      alerts.push({
        timestamp: snapshot.timestamp,
        type: 'critical',
        resource: 'cpu',
        metric: 'usage',
        current: snapshot.system.cpu.usage,
        threshold: this.config.thresholds.cpu.critical,
        message: `Critical CPU usage: ${snapshot.system.cpu.usage.toFixed(1)}%`,
        impact: 'high'
      });
    } else if (snapshot.system.cpu.usage > this.config.thresholds.cpu.warning) {
      alerts.push({
        timestamp: snapshot.timestamp,
        type: 'warning',
        resource: 'cpu',
        metric: 'usage',
        current: snapshot.system.cpu.usage,
        threshold: this.config.thresholds.cpu.warning,
        message: `High CPU usage: ${snapshot.system.cpu.usage.toFixed(1)}%`,
        impact: 'medium'
      });
    }

    // Memory threshold checks
    if (snapshot.system.memory.usage > this.config.thresholds.memory.critical) {
      alerts.push({
        timestamp: snapshot.timestamp,
        type: 'critical',
        resource: 'memory',
        metric: 'usage',
        current: snapshot.system.memory.usage,
        threshold: this.config.thresholds.memory.critical,
        message: `Critical memory usage: ${snapshot.system.memory.usage.toFixed(1)}%`,
        impact: 'high'
      });
    } else if (snapshot.system.memory.usage > this.config.thresholds.memory.warning) {
      alerts.push({
        timestamp: snapshot.timestamp,
        type: 'warning',
        resource: 'memory',
        metric: 'usage',
        current: snapshot.system.memory.usage,
        threshold: this.config.thresholds.memory.warning,
        message: `High memory usage: ${snapshot.system.memory.usage.toFixed(1)}%`,
        impact: 'medium'
      });
    }

    // Disk threshold checks
    if (snapshot.system.disk.usage > this.config.thresholds.disk.usageCritical) {
      alerts.push({
        timestamp: snapshot.timestamp,
        type: 'critical',
        resource: 'disk',
        metric: 'usage',
        current: snapshot.system.disk.usage,
        threshold: this.config.thresholds.disk.usageCritical,
        message: `Critical disk usage: ${snapshot.system.disk.usage.toFixed(1)}%`,
        impact: 'high'
      });
    } else if (snapshot.system.disk.usage > this.config.thresholds.disk.usageWarning) {
      alerts.push({
        timestamp: snapshot.timestamp,
        type: 'warning',
        resource: 'disk',
        metric: 'usage',
        current: snapshot.system.disk.usage,
        threshold: this.config.thresholds.disk.usageWarning,
        message: `High disk usage: ${snapshot.system.disk.usage.toFixed(1)}%`,
        impact: 'medium'
      });
    }

    // IO Wait threshold checks
    if (snapshot.system.disk.ioWait > this.config.thresholds.disk.ioWaitCritical) {
      alerts.push({
        timestamp: snapshot.timestamp,
        type: 'critical',
        resource: 'disk',
        metric: 'ioWait',
        current: snapshot.system.disk.ioWait,
        threshold: this.config.thresholds.disk.ioWaitCritical,
        message: `Critical IO wait: ${snapshot.system.disk.ioWait.toFixed(1)}%`,
        impact: 'high'
      });
    } else if (snapshot.system.disk.ioWait > this.config.thresholds.disk.ioWaitWarning) {
      alerts.push({
        timestamp: snapshot.timestamp,
        type: 'warning',
        resource: 'disk',
        metric: 'ioWait',  
        current: snapshot.system.disk.ioWait,
        threshold: this.config.thresholds.disk.ioWaitWarning,
        message: `High IO wait: ${snapshot.system.disk.ioWait.toFixed(1)}%`,
        impact: 'medium'
      });
    }

    // Process-specific alerts if monitoring enabled
    if (snapshot.process && this.config.enableProcessMonitoring) {
      if (snapshot.process.memoryPercent > 50) { // Process using more than 50% of system memory
        alerts.push({
          timestamp: snapshot.timestamp,
          type: snapshot.process.memoryPercent > 80 ? 'critical' : 'warning',
          resource: 'process',
          metric: 'memory',
          current: snapshot.process.memoryPercent,
          threshold: 50,
          message: `Process memory usage: ${snapshot.process.memoryPercent.toFixed(1)}%`,
          impact: snapshot.process.memoryPercent > 80 ? 'high' : 'medium'
        });
      }

      if (snapshot.process.cpu > 200) { // Process using more than 200% CPU (2 cores)
        alerts.push({
          timestamp: snapshot.timestamp,
          type: snapshot.process.cpu > 400 ? 'critical' : 'warning',
          resource: 'process',
          metric: 'cpu',
          current: snapshot.process.cpu,
          threshold: 200,
          message: `Process CPU usage: ${snapshot.process.cpu.toFixed(1)}%`,
          impact: snapshot.process.cpu > 400 ? 'high' : 'medium'
        });
      }
    }

    // Add alerts to session and emit events
    for (const alert of alerts) {
      this.currentSession.alerts.push(alert);
      this.emit('alert', alert);
      
      if (alert.type === 'critical') {
        console.warn(`🚨 CRITICAL ALERT: ${alert.message}`);
      } else {
        console.warn(`⚠️  WARNING: ${alert.message}`);
      }
    }
  }

  /**
   * Generate summary statistics
   */
  private generateSummary(): void {
    if (!this.currentSession || this.currentSession.snapshots.length === 0) return;

    const snapshots = this.currentSession.snapshots;
    const summary = this.currentSession.summary;

    // CPU statistics
    const cpuUsages = snapshots.map(s => s.system.cpu.usage);
    summary.avgCpu = cpuUsages.reduce((a, b) => a + b, 0) / cpuUsages.length;
    summary.maxCpu = Math.max(...cpuUsages);

    // Memory statistics
    const memoryUsages = snapshots.map(s => s.system.memory.usage);
    summary.avgMemory = memoryUsages.reduce((a, b) => a + b, 0) / memoryUsages.length;
    summary.maxMemory = Math.max(...memoryUsages);

    // Disk I/O statistics
    const diskIOs = snapshots.map(s => s.system.disk.reads + s.system.disk.writes);
    summary.avgDiskIo = diskIOs.reduce((a, b) => a + b, 0) / diskIOs.length;
    summary.maxDiskIo = Math.max(...diskIOs);

    // Network statistics
    const networkRxs = snapshots.map(s => s.system.network.rx);
    const networkTxs = snapshots.map(s => s.system.network.tx);
    summary.avgNetworkRx = networkRxs.reduce((a, b) => a + b, 0) / networkRxs.length;
    summary.avgNetworkTx = networkTxs.reduce((a, b) => a + b, 0) / networkTxs.length;

    // Alert statistics
    summary.totalAlerts = this.currentSession.alerts.length;
    summary.criticalAlerts = this.currentSession.alerts.filter(a => a.type === 'critical').length;

    // Process statistics if available
    if (this.currentSession.processStats && snapshots.some(s => s.process)) {
      const processSnapshots = snapshots.filter(s => s.process);
      const processCpus = processSnapshots.map(s => s.process!.cpu);
      const processMemories = processSnapshots.map(s => s.process!.memoryPercent);
      const processThreads = processSnapshots.map(s => s.process!.threads);

      this.currentSession.processStats.avgCpu = processCpus.reduce((a, b) => a + b, 0) / processCpus.length;
      this.currentSession.processStats.maxCpu = Math.max(...processCpus);
      this.currentSession.processStats.avgMemory = processMemories.reduce((a, b) => a + b, 0) / processMemories.length;
      this.currentSession.processStats.maxMemory = Math.max(...processMemories);
      this.currentSession.processStats.peakThreads = Math.max(...processThreads);
    }
  }

  /**
   * Save monitoring session to file
   */
  private async saveSession(session: MonitoringSession): Promise<void> {
    const fileName = `resource-monitor-${session.sessionId}.json`;
    const filePath = path.join(this.config.outputDir, fileName);
    
    try {
      await fs.writeJSON(filePath, session, { spaces: 2 });
      console.log(`Resource monitoring data saved: ${filePath}`);
      
      // Also generate a CSV summary for easy analysis
      await this.generateCSVSummary(session);
      
      // Generate HTML report
      await this.generateHTMLReport(session);
      
    } catch (error) {
      console.error('Failed to save monitoring session:', error);
      this.emit('error', error);
    }
  }

  /**
   * Generate CSV summary for analysis
   */
  private async generateCSVSummary(session: MonitoringSession): Promise<void> {
    const csvFileName = `resource-monitor-${session.sessionId}.csv`;
    const csvPath = path.join(this.config.outputDir, csvFileName);
    
    const headers = [
      'timestamp',
      'cpu_usage',
      'memory_usage',
      'memory_used_gb',
      'disk_reads',
      'disk_writes',
      'disk_io_wait',
      'network_rx_mbps',
      'network_tx_mbps',
      'process_cpu',
      'process_memory_percent'
    ];
    
    const rows = session.snapshots.map(snapshot => [
      new Date(snapshot.timestamp).toISOString(),
      snapshot.system.cpu.usage.toFixed(2),
      snapshot.system.memory.usage.toFixed(2),
      (snapshot.system.memory.used / 1024 / 1024 / 1024).toFixed(2),
      snapshot.system.disk.reads.toFixed(0),
      snapshot.system.disk.writes.toFixed(0),
      snapshot.system.disk.ioWait.toFixed(2),
      (snapshot.system.network.rx / 1024 / 1024 * 8).toFixed(2), // Convert to Mbps
      (snapshot.system.network.tx / 1024 / 1024 * 8).toFixed(2), // Convert to Mbps
      snapshot.process?.cpu?.toFixed(2) || '',
      snapshot.process?.memoryPercent?.toFixed(2) || ''
    ]);
    
    const csvContent = [headers.join(','), ...rows.map(row => row.join(','))].join('\n');
    
    await fs.writeFile(csvPath, csvContent);
    console.log(`CSV summary saved: ${csvPath}`);
  }

  /**
   * Generate HTML report
   */
  private async generateHTMLReport(session: MonitoringSession): Promise<void> {
    const htmlFileName = `resource-monitor-${session.sessionId}.html`;
    const htmlPath = path.join(this.config.outputDir, htmlFileName);
    
    const html = this.generateReportHTML(session);
    await fs.writeFile(htmlPath, html);
    console.log(`HTML report saved: ${htmlPath}`);
  }

  /**
   * Generate HTML report content
   */
  private generateReportHTML(session: MonitoringSession): string {
    const durationMinutes = session.duration ? (session.duration / 60000).toFixed(1) : 'Unknown';
    
    return `<!DOCTYPE html>
<html>
<head>
    <title>Resource Monitor Report - ${session.sessionId}</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 20px; }
        .header { background: #f0f8ff; padding: 20px; border-radius: 5px; }
        .summary { background: #f9f9f9; padding: 15px; border-radius: 5px; margin: 20px 0; }
        .metric { display: inline-block; margin: 10px 20px; }
        .alert { padding: 10px; margin: 5px 0; border-radius: 3px; }
        .warning { background: #fff3cd; border: 1px solid #ffeaa7; }
        .critical { background: #f8d7da; border: 1px solid #f5c6cb; }
        table { width: 100%; border-collapse: collapse; margin: 20px 0; }
        th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
        th { background-color: #f2f2f2; }
        .chart-placeholder { background: #f5f5f5; padding: 40px; text-align: center; margin: 20px 0; }
    </style>
</head>
<body>
    <div class="header">
        <h1>Resource Monitoring Report</h1>
        <p><strong>Session ID:</strong> ${session.sessionId}</p>
        <p><strong>Duration:</strong> ${durationMinutes} minutes</p>
        <p><strong>Start Time:</strong> ${new Date(session.startTime).toISOString()}</p>
        <p><strong>End Time:</strong> ${session.endTime ? new Date(session.endTime).toISOString() : 'In Progress'}</p>
        <p><strong>Snapshots:</strong> ${session.snapshots.length}</p>
    </div>
    
    <div class="summary">
        <h2>Performance Summary</h2>
        <div class="metric"><strong>Average CPU:</strong> ${session.summary.avgCpu.toFixed(1)}%</div>
        <div class="metric"><strong>Peak CPU:</strong> ${session.summary.maxCpu.toFixed(1)}%</div>
        <div class="metric"><strong>Average Memory:</strong> ${session.summary.avgMemory.toFixed(1)}%</div>
        <div class="metric"><strong>Peak Memory:</strong> ${session.summary.maxMemory.toFixed(1)}%</div>
        <div class="metric"><strong>Average Disk I/O:</strong> ${session.summary.avgDiskIo.toFixed(0)} ops/s</div>
        <div class="metric"><strong>Peak Disk I/O:</strong> ${session.summary.maxDiskIo.toFixed(0)} ops/s</div>
        <div class="metric"><strong>Average Network RX:</strong> ${(session.summary.avgNetworkRx / 1024 / 1024).toFixed(2)} MB/s</div>
        <div class="metric"><strong>Average Network TX:</strong> ${(session.summary.avgNetworkTx / 1024 / 1024).toFixed(2)} MB/s</div>
    </div>
    
    ${session.processStats ? `
    <div class="summary">
        <h2>Process Statistics (PID: ${session.processStats.pid})</h2>
        <div class="metric"><strong>Average CPU:</strong> ${session.processStats.avgCpu.toFixed(1)}%</div>
        <div class="metric"><strong>Peak CPU:</strong> ${session.processStats.maxCpu.toFixed(1)}%</div>
        <div class="metric"><strong>Average Memory:</strong> ${session.processStats.avgMemory.toFixed(1)}%</div>
        <div class="metric"><strong>Peak Memory:</strong> ${session.processStats.maxMemory.toFixed(1)}%</div>
        <div class="metric"><strong>Peak Threads:</strong> ${session.processStats.peakThreads}</div>
    </div>
    ` : ''}
    
    <h2>Alerts (${session.alerts.length} total, ${session.summary.criticalAlerts} critical)</h2>
    ${session.alerts.length > 0 ? 
      session.alerts.map(alert => `
        <div class="alert ${alert.type}">
            <strong>${alert.type.toUpperCase()}:</strong> ${alert.message} 
            (${new Date(alert.timestamp).toLocaleTimeString()})
        </div>
      `).join('') : 
      '<p>No alerts generated during monitoring period.</p>'
    }
    
    <div class="chart-placeholder">
        <h3>Resource Utilization Over Time</h3>
        <p>Charts would show CPU, Memory, Disk I/O, and Network usage trends over the monitoring period</p>
        <p>Peak usage times and correlation with performance events would be highlighted</p>
    </div>
    
    <h2>Detailed Snapshots (Last 10)</h2>
    <table>
        <tr>
            <th>Time</th>
            <th>CPU %</th>
            <th>Memory %</th>
            <th>Disk I/O</th>
            <th>Network RX/TX (MB/s)</th>
            ${session.processStats ? '<th>Process CPU %</th><th>Process Memory %</th>' : ''}
        </tr>
        ${session.snapshots.slice(-10).map(snapshot => `
        <tr>
            <td>${new Date(snapshot.timestamp).toLocaleTimeString()}</td>
            <td>${snapshot.system.cpu.usage.toFixed(1)}</td>
            <td>${snapshot.system.memory.usage.toFixed(1)}</td>
            <td>${(snapshot.system.disk.reads + snapshot.system.disk.writes).toFixed(0)}</td>
            <td>${(snapshot.system.network.rx / 1024 / 1024).toFixed(2)} / ${(snapshot.system.network.tx / 1024 / 1024).toFixed(2)}</td>
            ${session.processStats && snapshot.process ? 
              `<td>${snapshot.process.cpu.toFixed(1)}</td><td>${snapshot.process.memoryPercent.toFixed(1)}</td>` : 
              (session.processStats ? '<td>-</td><td>-</td>' : '')
            }
        </tr>
        `).join('')}
    </table>
    
    <div class="summary">
        <h2>Analysis & Recommendations</h2>
        <ul>
            ${session.summary.maxCpu > 80 ? '<li>High CPU usage detected - consider performance optimization</li>' : ''}
            ${session.summary.maxMemory > 85 ? '<li>High memory usage detected - check for memory leaks</li>' : ''}
            ${session.summary.maxDiskIo > 1000 ? '<li>High disk I/O detected - consider I/O optimization</li>' : ''}
            ${session.summary.criticalAlerts > 0 ? '<li>Critical alerts generated - immediate attention required</li>' : ''}
            ${session.alerts.length === 0 ? '<li>No resource alerts - system performed within normal parameters</li>' : ''}
            <li>Monitor resource trends during peak load periods</li>
            <li>Correlate resource usage with application performance metrics</li>
        </ul>
    </div>
</body>
</html>`;
  }

  /**
   * Get current monitoring status
   */
  public getStatus(): { isMonitoring: boolean; sessionId?: string; snapshots: number; alerts: number } {
    return {
      isMonitoring: this.isMonitoring,
      sessionId: this.currentSession?.sessionId,
      snapshots: this.currentSession?.snapshots.length || 0,
      alerts: this.currentSession?.alerts.length || 0
    };
  }

  /**
   * Get live snapshot (if monitoring)
   */
  public getCurrentSnapshot(): ResourceSnapshot | null {
    if (!this.currentSession || this.currentSession.snapshots.length === 0) {
      return null;
    }
    return this.currentSession.snapshots[this.currentSession.snapshots.length - 1];
  }

  /**
   * Configure process monitoring
   */
  public setProcessMonitoring(pid: number): void {
    this.config.processPid = pid;
    this.config.enableProcessMonitoring = true;
    
    if (this.currentSession) {
      this.currentSession.processStats = {
        pid: pid,
        avgCpu: 0,
        maxCpu: 0,
        avgMemory: 0,
        maxMemory: 0,
        peakThreads: 0
      };
    }
  }
}

// Export helper function for easy usage
export async function monitorDuringTest(
  testFunction: () => Promise<any>,
  config?: Partial<MonitoringConfig>
): Promise<{ testResult: any; monitoringSession: MonitoringSession }> {
  const monitor = new ResourceMonitor(config);
  
  const sessionId = await monitor.startMonitoring();
  
  let testResult;
  try {
    testResult = await testFunction();
  } finally {
    const monitoringSession = await monitor.stopMonitoring();
    return { testResult, monitoringSession: monitoringSession! };
  }
}