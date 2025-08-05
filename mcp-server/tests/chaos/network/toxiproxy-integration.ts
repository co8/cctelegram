/**
 * Toxiproxy Integration
 * 
 * Wrapper around Toxiproxy for network fault injection.
 * Provides high-level APIs for common network chaos scenarios.
 */

import { EventEmitter } from 'events';
import axios from 'axios';
import Dockerode from 'dockerode';
import { ToxiproxyClient } from 'toxiproxy-node';
import { secureLog } from '../../../src/security.js';

export interface ToxiproxyConfig {
  host: string;
  port: number;
  autoStart: boolean;
  containerName: string;
  containerImage: string;
  containerPorts: string[];
}

export interface ProxyConfig {
  name: string;
  listen: string;
  upstream: string;
  enabled: boolean;
}

export interface ToxicConfig {
  name: string;
  type: 'latency' | 'bandwidth' | 'slow_close' | 'timeout' | 'slicer' | 'limit_data';
  stream: 'upstream' | 'downstream';
  toxicity: number; // 0.0 to 1.0
  attributes: Record<string, any>;
}

export interface NetworkFaultConfig {
  type: 'partition' | 'latency' | 'bandwidth' | 'jitter' | 'packet_loss' | 'corruption';
  intensity: number;
  duration?: number;
  parameters: Record<string, any>;
}

export class ToxiproxyIntegration extends EventEmitter {
  private config: ToxiproxyConfig;
  private docker: Dockerode;
  private client?: ToxiproxyClient;
  private container?: Dockerode.Container;
  private activeProxies: Map<string, any> = new Map();
  private isInitialized: boolean = false;

  constructor(config?: Partial<ToxiproxyConfig>) {
    super();
    
    this.config = {
      host: process.env.TOXIPROXY_HOST || 'localhost',
      port: parseInt(process.env.TOXIPROXY_PORT || '8474'),
      autoStart: process.env.TOXIPROXY_AUTO_START === 'true',
      containerName: 'toxiproxy-chaos',
      containerImage: 'ghcr.io/shopify/toxiproxy:2.5.0',
      containerPorts: ['8474:8474', '26379-26389:26379-26389'],
      ...config
    };

    this.docker = new Dockerode();
  }

  /**
   * Initialize Toxiproxy integration
   */
  public async initialize(): Promise<void> {
    if (this.isInitialized) {
      return;
    }

    secureLog('info', 'Initializing Toxiproxy integration', {
      host: this.config.host,
      port: this.config.port,
      auto_start: this.config.autoStart
    });

    try {
      // Try to connect to existing Toxiproxy instance
      await this.connectToToxiproxy();
      
    } catch (error) {
      if (this.config.autoStart) {
        secureLog('info', 'Toxiproxy not available, starting container');
        await this.startToxiproxyContainer();
        
        // Wait a bit for container to start
        await new Promise(resolve => setTimeout(resolve, 3000));
        
        await this.connectToToxiproxy();
      } else {
        throw new Error(`Toxiproxy not available and auto-start disabled: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    }

    this.isInitialized = true;
    this.emit('initialized');

    secureLog('info', 'Toxiproxy integration initialized successfully');
  }

  /**
   * Connect to Toxiproxy server
   */
  private async connectToToxiproxy(): Promise<void> {
    const toxiproxyUrl = `http://${this.config.host}:${this.config.port}`;
    this.client = new ToxiproxyClient(toxiproxyUrl);

    // Test connection by getting version
    const version = await this.client.getVersion();
    secureLog('info', 'Connected to Toxiproxy', { version, url: toxiproxyUrl });
  }

  /**
   * Start Toxiproxy Docker container
   */
  private async startToxiproxyContainer(): Promise<void> {
    try {
      // Check if container already exists
      const containers = await this.docker.listContainers({ all: true });
      const existingContainer = containers.find(c => 
        c.Names.some(name => name.includes(this.config.containerName))
      );

      if (existingContainer) {
        this.container = this.docker.getContainer(existingContainer.Id);
        
        if (existingContainer.State !== 'running') {
          secureLog('info', 'Starting existing Toxiproxy container');
          await this.container.start();
        } else {
          secureLog('info', 'Toxiproxy container already running');
        }
        return;
      }

      // Create and start new container
      secureLog('info', 'Creating new Toxiproxy container');
      
      const portBindings: Record<string, Array<{ HostPort: string }>> = {};
      this.config.containerPorts.forEach(portMapping => {
        const [hostPort, containerPort] = portMapping.split(':');
        portBindings[`${containerPort}/tcp`] = [{ HostPort: hostPort }];
      });

      this.container = await this.docker.createContainer({
        Image: this.config.containerImage,
        name: this.config.containerName,
        HostConfig: {
          PortBindings: portBindings,
          AutoRemove: false
        },
        ExposedPorts: Object.keys(portBindings).reduce((acc, port) => {
          acc[port] = {};
          return acc;
        }, {} as Record<string, {}>)
      });

      await this.container.start();
      secureLog('info', 'Toxiproxy container started successfully');

      // Wait for container to be ready
      await this.waitForContainerReady();

    } catch (error) {
      throw new Error(`Failed to start Toxiproxy container: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Wait for Toxiproxy container to be ready
   */
  private async waitForContainerReady(maxWaitTime: number = 30000): Promise<void> {
    const startTime = Date.now();
    const checkInterval = 1000;

    while (Date.now() - startTime < maxWaitTime) {
      try {
        const response = await axios.get(`http://${this.config.host}:${this.config.port}/version`, {
          timeout: 2000
        });
        
        if (response.status === 200) {
          secureLog('info', 'Toxiproxy container is ready');
          return;
        }
      } catch (error) {
        // Container not ready yet, continue waiting
      }

      await new Promise(resolve => setTimeout(resolve, checkInterval));
    }

    throw new Error('Toxiproxy container failed to become ready within timeout');
  }

  /**
   * Create a network fault
   */
  public async createNetworkFault(
    faultConfig: NetworkFaultConfig,
    targetService: { host: string; port: number; },
    proxyPort: number
  ): Promise<string> {
    
    if (!this.client) {
      throw new Error('Toxiproxy not initialized');
    }

    const proxyName = `chaos_${faultConfig.type}_${Date.now()}`;
    const proxyConfig: ProxyConfig = {
      name: proxyName,
      listen: `0.0.0.0:${proxyPort}`,
      upstream: `${targetService.host}:${targetService.port}`,
      enabled: true
    };

    secureLog('info', 'Creating network fault', {
      proxy_name: proxyName,
      fault_type: faultConfig.type,
      intensity: faultConfig.intensity,
      target: `${targetService.host}:${targetService.port}`,
      proxy_port: proxyPort
    });

    try {
      // Create proxy
      const proxy = await this.client.createProxy(proxyConfig);
      this.activeProxies.set(proxyName, proxy);

      // Add toxic based on fault type
      const toxic = this.createToxicConfig(faultConfig);
      await proxy.addToxic(toxic);

      this.emit('faultCreated', {
        proxyName,
        faultType: faultConfig.type,
        proxyPort,
        targetService
      });

      return proxyName;

    } catch (error) {
      throw new Error(`Failed to create network fault: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Create toxic configuration based on fault type
   */
  private createToxicConfig(faultConfig: NetworkFaultConfig): ToxicConfig {
    switch (faultConfig.type) {
      case 'partition':
        return {
          name: 'network_partition',
          type: 'bandwidth',
          stream: 'downstream',
          toxicity: faultConfig.intensity,
          attributes: {
            rate: 0 // 0 bytes per second = complete partition
          }
        };

      case 'latency':
        const latencyMs = Math.floor(faultConfig.intensity * (faultConfig.parameters.maxLatency || 5000));
        return {
          name: 'high_latency',
          type: 'latency',
          stream: 'downstream',
          toxicity: 1.0, // Apply to all requests
          attributes: {
            latency: latencyMs,
            jitter: Math.floor(latencyMs * 0.1) // 10% jitter
          }
        };

      case 'bandwidth':
        const maxBandwidth = faultConfig.parameters.maxBandwidth || 1000000; // 1MB/s default
        const limitedBandwidth = Math.floor(maxBandwidth * (1 - faultConfig.intensity));
        return {
          name: 'bandwidth_limit',
          type: 'bandwidth',
          stream: 'downstream',
          toxicity: 1.0,
          attributes: {
            rate: limitedBandwidth // bytes per second
          }
        };

      case 'jitter':
        return {
          name: 'network_jitter',
          type: 'latency',
          stream: 'downstream',
          toxicity: 1.0,
          attributes: {
            latency: faultConfig.parameters.baseLatency || 100,
            jitter: Math.floor(faultConfig.intensity * (faultConfig.parameters.jitterRange || 1000))
          }
        };

      case 'packet_loss':
        return {
          name: 'packet_loss',
          type: 'slicer',
          stream: 'downstream',
          toxicity: faultConfig.intensity,
          attributes: {
            average_size: 0, // Drop entire packets
            size_variation: 0,
            delay: 0
          }
        };

      case 'corruption':
        return {
          name: 'data_corruption',
          type: 'slicer',
          stream: 'downstream',
          toxicity: faultConfig.intensity,
          attributes: {
            average_size: 1, // Corrupt 1 byte at a time
            size_variation: 0,
            delay: 0
          }
        };

      default:
        throw new Error(`Unsupported fault type: ${faultConfig.type}`);
    }
  }

  /**
   * Remove network fault
   */
  public async removeNetworkFault(proxyName: string): Promise<boolean> {
    if (!this.client) {
      throw new Error('Toxiproxy not initialized');
    }

    try {
      const proxy = this.activeProxies.get(proxyName);
      if (proxy) {
        // Remove all toxics first
        const toxics = await proxy.getToxics();
        for (const toxic of toxics) {
          await proxy.removeToxic(toxic.name);
        }

        // Delete the proxy
        await this.client.deleteProxy(proxyName);
        this.activeProxies.delete(proxyName);

        this.emit('faultRemoved', { proxyName });

        secureLog('info', 'Network fault removed', { proxy_name: proxyName });
        return true;
      }

      return false;

    } catch (error) {
      secureLog('error', 'Failed to remove network fault', {
        proxy_name: proxyName,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      return false;
    }
  }

  /**
   * Update fault intensity
   */
  public async updateFaultIntensity(proxyName: string, newIntensity: number): Promise<boolean> {
    if (!this.client) {
      throw new Error('Toxiproxy not initialized');
    }

    try {
      const proxy = this.activeProxies.get(proxyName);
      if (!proxy) {
        return false;
      }

      const toxics = await proxy.getToxics();
      for (const toxic of toxics) {
        // Update toxicity or specific attributes based on toxic type
        if (toxic.type === 'bandwidth') {
          const currentRate = toxic.attributes.rate;
          const maxRate = currentRate / (1 - toxic.toxicity);
          const newRate = Math.floor(maxRate * (1 - newIntensity));
          
          await proxy.updateToxic(toxic.name, {
            ...toxic,
            toxicity: newIntensity,
            attributes: {
              ...toxic.attributes,
              rate: newRate
            }
          });
        } else {
          await proxy.updateToxic(toxic.name, {
            ...toxic,
            toxicity: newIntensity
          });
        }
      }

      this.emit('faultUpdated', { proxyName, newIntensity });
      return true;

    } catch (error) {
      secureLog('error', 'Failed to update fault intensity', {
        proxy_name: proxyName,
        new_intensity: newIntensity,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      return false;
    }
  }

  /**
   * Get proxy status
   */
  public async getProxyStatus(proxyName: string): Promise<any> {
    if (!this.client) {
      throw new Error('Toxiproxy not initialized');
    }

    try {
      const proxy = this.activeProxies.get(proxyName);
      if (!proxy) {
        return null;
      }

      const [proxyInfo, toxics] = await Promise.all([
        proxy.getProxy(),
        proxy.getToxics()
      ]);

      return {
        name: proxyInfo.name,
        listen: proxyInfo.listen,
        upstream: proxyInfo.upstream,
        enabled: proxyInfo.enabled,
        toxics: toxics.map(toxic => ({
          name: toxic.name,
          type: toxic.type,
          stream: toxic.stream,
          toxicity: toxic.toxicity,
          attributes: toxic.attributes
        }))
      };

    } catch (error) {
      secureLog('error', 'Failed to get proxy status', {
        proxy_name: proxyName,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      return null;
    }
  }

  /**
   * List all active proxies
   */
  public async listActiveProxies(): Promise<any[]> {
    if (!this.client) {
      throw new Error('Toxiproxy not initialized');
    }

    try {
      const proxies = await this.client.getProxies();
      return proxies.map(proxy => ({
        name: proxy.name,
        listen: proxy.listen,
        upstream: proxy.upstream,
        enabled: proxy.enabled
      }));

    } catch (error) {
      secureLog('error', 'Failed to list proxies', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      return [];
    }
  }

  /**
   * Create multiple network faults in sequence
   */
  public async createCascadingFaults(
    faultSequence: Array<{
      faultConfig: NetworkFaultConfig;
      targetService: { host: string; port: number; };
      proxyPort: number;
      delay: number; // Delay before creating this fault
    }>
  ): Promise<string[]> {
    
    const createdProxies: string[] = [];

    for (const [index, faultSpec] of faultSequence.entries()) {
      // Wait for delay
      if (faultSpec.delay > 0) {
        await new Promise(resolve => setTimeout(resolve, faultSpec.delay));
      }

      try {
        const proxyName = await this.createNetworkFault(
          faultSpec.faultConfig,
          faultSpec.targetService,
          faultSpec.proxyPort
        );
        
        createdProxies.push(proxyName);

        secureLog('info', 'Cascading fault created', {
          sequence_index: index,
          proxy_name: proxyName,
          fault_type: faultSpec.faultConfig.type
        });

      } catch (error) {
        secureLog('error', 'Failed to create cascading fault', {
          sequence_index: index,
          fault_type: faultSpec.faultConfig.type,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    }

    return createdProxies;
  }

  /**
   * Clean up all active faults
   */
  public async cleanup(): Promise<void> {
    secureLog('info', 'Cleaning up Toxiproxy faults', {
      active_proxies: this.activeProxies.size
    });

    const cleanupPromises = Array.from(this.activeProxies.keys()).map(proxyName =>
      this.removeNetworkFault(proxyName)
    );

    await Promise.allSettled(cleanupPromises);

    this.activeProxies.clear();
    this.emit('cleanupCompleted');
  }

  /**
   * Shutdown Toxiproxy integration
   */
  public async shutdown(): Promise<void> {
    // Clean up active faults
    await this.cleanup();

    // Stop container if we started it
    if (this.container && this.config.autoStart) {
      try {
        secureLog('info', 'Stopping Toxiproxy container');
        await this.container.stop();
        await this.container.remove();
        secureLog('info', 'Toxiproxy container stopped and removed');
      } catch (error) {
        secureLog('warn', 'Failed to stop Toxiproxy container', {
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    }

    this.isInitialized = false;
    this.client = undefined;
    this.container = undefined;

    this.emit('shutdown');
    secureLog('info', 'Toxiproxy integration shutdown completed');
  }

  /**
   * Get health status
   */
  public async getHealthStatus(): Promise<{
    healthy: boolean;
    version?: string;
    activeProxies: number;
    error?: string;
  }> {
    try {
      if (!this.client) {
        return {
          healthy: false,
          activeProxies: 0,
          error: 'Toxiproxy not initialized'
        };
      }

      const version = await this.client.getVersion();
      
      return {
        healthy: true,
        version,
        activeProxies: this.activeProxies.size
      };

    } catch (error) {
      return {
        healthy: false,
        activeProxies: this.activeProxies.size,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Test network connectivity
   */
  public async testConnectivity(targetService: { host: string; port: number; }): Promise<{
    reachable: boolean;
    responseTime?: number;
    error?: string;
  }> {
    const startTime = Date.now();
    
    try {
      // Simple HTTP health check
      const response = await axios.get(`http://${targetService.host}:${targetService.port}/health`, {
        timeout: 5000,
        validateStatus: () => true // Accept any status code
      });

      return {
        reachable: true,
        responseTime: Date.now() - startTime
      };

    } catch (error) {
      return {
        reachable: false,
        responseTime: Date.now() - startTime,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Get configuration
   */
  public getConfig(): ToxiproxyConfig {
    return { ...this.config };
  }

  /**
   * Check if initialized
   */
  public isReady(): boolean {
    return this.isInitialized && !!this.client;
  }
}