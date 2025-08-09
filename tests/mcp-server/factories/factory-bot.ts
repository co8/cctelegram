/**
 * Factory Bot Implementation for CCTelegram Bridge
 * 
 * Implements the factory-bot pattern for generating consistent test data
 * with traits, sequences, and dynamic attribute generation.
 */

import { randomUUID } from 'crypto';

/**
 * Base interface for factory definitions
 */
export interface FactoryDefinition<T> {
  name: string;
  build(): T;
  traits?: Record<string, (obj: T) => T>;
  sequences?: Record<string, () => any>;
}

/**
 * Factory registry to manage all factory definitions
 */
class FactoryRegistry {
  private factories = new Map<string, FactoryDefinition<any>>();
  private sequences = new Map<string, { value: number; generator: (n: number) => any }>();

  /**
   * Register a factory definition
   */
  register<T>(factory: FactoryDefinition<T>): void {
    this.factories.set(factory.name, factory);
    
    // Register any sequences defined in the factory
    if (factory.sequences) {
      Object.entries(factory.sequences).forEach(([name, generator]) => {
        this.sequences.set(name, { value: 0, generator });
      });
    }
  }

  /**
   * Build a single object using the specified factory
   */
  build<T>(factoryName: string, overrides: Partial<T> = {}, traits: string[] = []): T {
    const factory = this.factories.get(factoryName);
    if (!factory) {
      throw new Error(`Factory "${factoryName}" not found`);
    }

    let obj = factory.build();

    // Apply traits
    if (factory.traits) {
      traits.forEach(traitName => {
        const trait = factory.traits![traitName];
        if (!trait) {
          throw new Error(`Trait "${traitName}" not found in factory "${factoryName}"`);
        }
        obj = trait(obj);
      });
    }

    // Apply overrides
    return { ...obj, ...overrides };
  }

  /**
   * Build multiple objects using the specified factory
   */
  buildList<T>(factoryName: string, count: number, overrides: Partial<T> = {}, traits: string[] = []): T[] {
    return Array.from({ length: count }, () => this.build(factoryName, overrides, traits));
  }

  /**
   * Get next value from a sequence
   */
  sequence(name: string): any {
    const seq = this.sequences.get(name);
    if (!seq) {
      throw new Error(`Sequence "${name}" not found`);
    }
    
    seq.value += 1;
    return seq.generator(seq.value);
  }

  /**
   * Reset all sequences to their initial values
   */
  resetSequences(): void {
    this.sequences.forEach(seq => {
      seq.value = 0;
    });
  }

  /**
   * Clear all factories and sequences (for testing)
   */
  clear(): void {
    this.factories.clear();
    this.sequences.clear();
  }

  /**
   * List all registered factory names
   */
  listFactories(): string[] {
    return Array.from(this.factories.keys());
  }
}

// Global factory registry instance
export const factoryRegistry = new FactoryRegistry();

/**
 * Factory helper functions
 */
export class Factory {
  /**
   * Register a new factory
   */
  static define<T>(name: string, buildFn: () => T, options: {
    traits?: Record<string, (obj: T) => T>;
    sequences?: Record<string, () => any>;
  } = {}): void {
    factoryRegistry.register({
      name,
      build: buildFn,
      traits: options.traits,
      sequences: options.sequences
    });
  }

  /**
   * Build a single object
   */
  static build<T>(factoryName: string, overrides: Partial<T> = {}, traits: string[] = []): T {
    return factoryRegistry.build(factoryName, overrides, traits);
  }

  /**
   * Build multiple objects
   */
  static buildList<T>(factoryName: string, count: number, overrides: Partial<T> = {}, traits: string[] = []): T[] {
    return factoryRegistry.buildList(factoryName, count, overrides, traits);
  }

  /**
   * Get next value from a sequence
   */
  static sequence(name: string): any {
    return factoryRegistry.sequence(name);
  }

  /**
   * Reset all sequences
   */
  static resetSequences(): void {
    factoryRegistry.resetSequences();
  }

  /**
   * Clear all factories (for testing)
   */
  static clear(): void {
    factoryRegistry.clear();
  }

  /**
   * List all registered factories
   */
  static listFactories(): string[] {
    return factoryRegistry.listFactories();
  }
}

/**
 * Common utility functions for factories
 */
export const FactoryUtils = {
  /**
   * Generate a random timestamp within a range
   */
  randomTimestamp(
    start: Date = new Date(Date.now() - 24 * 60 * 60 * 1000), // 24 hours ago
    end: Date = new Date()
  ): string {
    const startTime = start.getTime();
    const endTime = end.getTime();
    const randomTime = startTime + Math.random() * (endTime - startTime);
    return new Date(randomTime).toISOString();
  },

  /**
   * Generate a random number within a range
   */
  randomNumber(min: number = 0, max: number = 100): number {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  },

  /**
   * Generate a random float within a range
   */
  randomFloat(min: number = 0, max: number = 100, decimals: number = 2): number {
    const value = Math.random() * (max - min) + min;
    return parseFloat(value.toFixed(decimals));
  },

  /**
   * Pick a random element from an array
   */
  randomChoice<T>(choices: T[]): T {
    if (choices.length === 0) {
      throw new Error('Cannot pick from empty array');
    }
    return choices[Math.floor(Math.random() * choices.length)];
  },

  /**
   * Generate a random boolean with optional probability
   */
  randomBoolean(probability: number = 0.5): boolean {
    return Math.random() < probability;
  },

  /**
   * Generate a random UUID
   */
  randomUUID(): string {
    return randomUUID();
  },

  /**
   * Generate a random string with specified length
   */
  randomString(length: number = 10, charset: string = 'abcdefghijklmnopqrstuvwxyz0123456789'): string {
    let result = '';
    for (let i = 0; i < length; i++) {
      result += charset.charAt(Math.floor(Math.random() * charset.length));
    }
    return result;
  },

  /**
   * Generate a random file path
   */
  randomFilePath(extension: string = 'ts'): string {
    const dirs = ['src', 'tests', 'utils', 'components', 'services'];
    const dir = this.randomChoice(dirs);
    const filename = this.randomString(8);
    return `${dir}/${filename}.${extension}`;
  },

  /**
   * Generate a realistic error message
   */
  randomErrorMessage(): string {
    const errors = [
      'Connection timeout',
      'Network error',
      'Invalid response format',
      'Authentication failed',
      'Rate limit exceeded',
      'Service unavailable',
      'Internal server error',
      'Permission denied',
      'Resource not found',
      'Validation error'
    ];
    return this.randomChoice(errors);
  },

  /**
   * Generate a random IP address
   */
  randomIPAddress(): string {
    return Array.from({ length: 4 }, () => Math.floor(Math.random() * 256)).join('.');
  },

  /**
   * Generate a random user agent string
   */
  randomUserAgent(): string {
    const userAgents = [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36'
    ];
    return this.randomChoice(userAgents);
  }
};

/**
 * Sequence generators for common patterns
 */
export const Sequences = {
  /**
   * Incremental email sequence
   */
  email: (n: number) => `user${n}@example.com`,

  /**
   * Incremental username sequence
   */
  username: (n: number) => `user${n}`,

  /**
   * Incremental task ID sequence
   */
  taskId: (n: number) => `task-${n}`,

  /**
   * Incremental event ID sequence
   */
  eventId: (n: number) => `event-${n}`,

  /**
   * Incremental response ID sequence
   */
  responseId: (n: number) => `response-${n}`,

  /**
   * Incremental port sequence
   */
  port: (n: number) => 3000 + n,

  /**
   * Incremental user ID sequence
   */
  userId: (n: number) => 100000000 + n,

  /**
   * Incremental PID sequence
   */
  pid: (n: number) => 1000 + n,

  /**
   * Incremental version sequence
   */
  version: (n: number) => `0.${n}.0`,

  /**
   * Incremental timestamp sequence (1 minute intervals)
   */
  timestamp: (n: number) => new Date(Date.now() + n * 60 * 1000).toISOString()
};

/**
 * Global setup function to register all factories
 * Should be called once in test setup
 */
export function setupFactories(): void {
  // Reset any existing state
  Factory.clear();
  
  // Import and register all factory definitions
  import('./event-factories.js');
  import('./response-factories.js');
  import('./bridge-factories.js');
  import('./system-factories.js');
  import('./config-factories.js');
}

/**
 * Global cleanup function for factories
 * Should be called in test teardown
 */
export function cleanupFactories(): void {
  Factory.resetSequences();
}