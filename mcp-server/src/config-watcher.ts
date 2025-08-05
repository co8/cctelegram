/**
 * Configuration File Watcher
 * Monitors configuration files for changes and invalidates caches
 */

import fs from 'fs-extra';
import path from 'path';
import { FSWatcher } from 'fs';
import { invalidateSecurityConfigCache, secureLog } from './security.js';

interface ConfigWatcher {
  watcher: FSWatcher | null;
  watchedPaths: Set<string>;
  isActive: boolean;
}

const configWatcher: ConfigWatcher = {
  watcher: null,
  watchedPaths: new Set(),
  isActive: false
};

/**
 * Initialize configuration file watching
 */
export function initializeConfigWatcher(): void {
  try {
    // Watch environment files that could affect configuration
    const watchPaths = getConfigWatchPaths();
    
    if (watchPaths.length === 0) {
      secureLog('info', 'No configuration files found to watch');
      return;
    }
    
    // Set up file system watcher
    configWatcher.watcher = fs.watch('', { recursive: false }, (eventType, filename) => {
      if (!filename) return;
      
      const fullPath = path.resolve(filename);
      
      // Check if this is a watched configuration file
      if (configWatcher.watchedPaths.has(fullPath)) {
        secureLog('info', 'Configuration file changed, invalidating cache', {
          file: filename,
          event_type: eventType
        });
        
        // Invalidate security config cache
        invalidateSecurityConfigCache();
        
        // Add small delay to prevent rapid successive invalidations
        setTimeout(() => {
          secureLog('debug', 'Configuration cache invalidation cooldown complete');
        }, 1000);
      }
    });
    
    // Watch each configuration file individually
    for (const watchPath of watchPaths) {
      try {
        if (fs.existsSync(watchPath)) {
          configWatcher.watchedPaths.add(watchPath);
          secureLog('debug', 'Watching configuration file', { path: watchPath });
        }
      } catch (error) {
        secureLog('warn', 'Failed to watch configuration file', {
          path: watchPath,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    }
    
    configWatcher.isActive = true;
    secureLog('info', 'Configuration file watcher initialized', {
      watched_files: configWatcher.watchedPaths.size
    });
    
  } catch (error) {
    secureLog('error', 'Failed to initialize configuration file watcher', {
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}

/**
 * Stop configuration file watching
 */
export function stopConfigWatcher(): void {
  try {
    if (configWatcher.watcher) {
      configWatcher.watcher.close();
      configWatcher.watcher = null;
    }
    
    configWatcher.watchedPaths.clear();
    configWatcher.isActive = false;
    
    secureLog('info', 'Configuration file watcher stopped');
  } catch (error) {
    secureLog('error', 'Error stopping configuration file watcher', {
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}

/**
 * Get configuration file paths to watch
 */
function getConfigWatchPaths(): string[] {
  const homeDir = process.env.HOME || process.env.USERPROFILE || '/tmp';
  const watchPaths: string[] = [];
  
  // Common .env file locations
  const envPaths = [
    // Project directory
    path.join(process.cwd(), '..', '.env'),
    path.join(process.cwd(), '.env'),
    // User's .cc_telegram directory
    path.join(homeDir, '.cc_telegram', '.env'),
    // System-wide configuration
    '/etc/cctelegram/.env'
  ];
  
  // Add existing .env files to watch list
  for (const envPath of envPaths) {
    try {
      if (fs.existsSync(envPath)) {
        watchPaths.push(path.resolve(envPath));
      }
    } catch (error) {
      // Ignore access errors for potential paths
    }
  }
  
  // Watch for configuration files that might be created
  const potentialConfigDirs = [
    process.cwd(),
    path.join(process.cwd(), '..'),
    path.join(homeDir, '.cc_telegram')
  ];
  
  for (const configDir of potentialConfigDirs) {
    try {
      if (fs.existsSync(configDir)) {
        watchPaths.push(configDir);
      }
    } catch (error) {
      // Ignore access errors
    }
  }
  
  return [...new Set(watchPaths)]; // Remove duplicates
}

/**
 * Get configuration watcher status
 */
export function getConfigWatcherStatus(): {
  active: boolean;
  watched_paths: number;
  paths: string[];
} {
  return {
    active: configWatcher.isActive,
    watched_paths: configWatcher.watchedPaths.size,
    paths: Array.from(configWatcher.watchedPaths)
  };
}

/**
 * Add additional path to watch
 */
export function addConfigWatchPath(filePath: string): void {
  try {
    const resolvedPath = path.resolve(filePath);
    
    if (fs.existsSync(resolvedPath)) {
      configWatcher.watchedPaths.add(resolvedPath);
      secureLog('info', 'Added configuration file to watch list', {
        path: resolvedPath
      });
    } else {
      secureLog('warn', 'Cannot watch non-existent configuration file', {
        path: resolvedPath
      });
    }
  } catch (error) {
    secureLog('error', 'Failed to add configuration file to watch list', {
      path: filePath,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}

/**
 * Remove path from watch list
 */
export function removeConfigWatchPath(filePath: string): void {
  const resolvedPath = path.resolve(filePath);
  
  if (configWatcher.watchedPaths.has(resolvedPath)) {
    configWatcher.watchedPaths.delete(resolvedPath);
    secureLog('info', 'Removed configuration file from watch list', {
      path: resolvedPath
    });
  }
}

// Graceful shutdown handling
process.on('SIGINT', stopConfigWatcher);
process.on('SIGTERM', stopConfigWatcher);
process.on('exit', stopConfigWatcher);