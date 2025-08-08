/**
 * TaskMaster Data Generator
 * Creates test TaskMaster data for debugging the bridge issue
 */

import fs from 'fs/promises';
import path from 'path';
import { DebugLogger } from './debug-logger';

export interface TaskMasterStats {
  completed: number;
  total: number;
  pending: number;
  in_progress: number;
  blocked: number;
  subtasks_completed: number;
  subtasks_total: number;
}

export interface TaskMasterTask {
  id: string;
  title: string;
  description: string;
  status: 'pending' | 'in-progress' | 'done' | 'completed' | 'blocked' | 'deferred' | 'cancelled';
  priority?: 'low' | 'medium' | 'high';
  dependencies?: string[];
  details?: string;
  testStrategy?: string;
  subtasks?: TaskMasterTask[];
  createdAt?: string;
  updatedAt?: string;
}

export interface TaskMasterData {
  version: string;
  tags: {
    master: {
      name: string;
      description: string;
      tasks: TaskMasterTask[];
      metadata: {
        createdAt: string;
        updatedAt: string;
      };
    };
  };
  currentTag: string;
}

export class TaskMasterDataGenerator {
  private projectRoot: string;
  private logger: DebugLogger;
  private backupPath: string | null = null;

  constructor(projectRoot: string, logger: DebugLogger) {
    this.projectRoot = projectRoot;
    this.logger = logger;
  }

  async createTestProject(): Promise<void> {
    this.logger.info('Creating test TaskMaster project...');

    // Ensure .taskmaster directory exists
    const taskmasterDir = path.join(this.projectRoot, '.taskmaster');
    const tasksDir = path.join(taskmasterDir, 'tasks');

    await fs.mkdir(taskmasterDir, { recursive: true });
    await fs.mkdir(tasksDir, { recursive: true });

    this.logger.info('✓ TaskMaster directory structure created');
  }

  async generateLiveTaskData(stats: TaskMasterStats): Promise<TaskMasterStats> {
    this.logger.info('Generating live TaskMaster data with stats:', stats);

    const tasksJsonPath = path.join(this.projectRoot, '.taskmaster', 'tasks', 'tasks.json');

    // Backup existing file if it exists
    try {
      await fs.access(tasksJsonPath);
      this.backupPath = `${tasksJsonPath}.backup.${Date.now()}`;
      await fs.copyFile(tasksJsonPath, this.backupPath);
      this.logger.info(`Backed up existing tasks.json to ${this.backupPath}`);
    } catch {
      // File doesn't exist, no need to backup
    }

    // Generate tasks based on required stats
    const tasks = await this.generateTasks(stats);

    const taskMasterData: TaskMasterData = {
      version: '1.0.0',
      tags: {
        master: {
          name: 'master',
          description: 'Master tag for CCTelegram testing',
          tasks,
          metadata: {
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
          }
        }
      },
      currentTag: 'master'
    };

    // Write the data to tasks.json
    await fs.writeFile(tasksJsonPath, JSON.stringify(taskMasterData, null, 2));

    this.logger.info(`✓ Generated TaskMaster data with ${tasks.length} tasks`);
    this.logger.info(`Stats: ${stats.completed}/${stats.total} tasks completed (${(stats.completed / stats.total * 100).toFixed(1)}%)`);

    return stats;
  }

  async updateTimestamp(): Promise<void> {
    const tasksJsonPath = path.join(this.projectRoot, '.taskmaster', 'tasks', 'tasks.json');
    
    try {
      const content = await fs.readFile(tasksJsonPath, 'utf-8');
      const data = JSON.parse(content) as TaskMasterData;
      
      // Update timestamps
      data.tags.master.metadata.updatedAt = new Date().toISOString();
      data.tags.master.tasks.forEach(task => {
        task.updatedAt = new Date().toISOString();
      });

      await fs.writeFile(tasksJsonPath, JSON.stringify(data, null, 2));
      this.logger.info('✓ Updated TaskMaster file timestamp');
    } catch (error) {
      this.logger.error('Failed to update timestamp:', error);
      throw error;
    }
  }

  async cleanup(): Promise<void> {
    // Restore backup if it exists
    if (this.backupPath) {
      const tasksJsonPath = path.join(this.projectRoot, '.taskmaster', 'tasks', 'tasks.json');
      
      try {
        await fs.copyFile(this.backupPath, tasksJsonPath);
        await fs.unlink(this.backupPath);
        this.logger.info('✓ Restored original tasks.json from backup');
      } catch (error) {
        this.logger.warn('Failed to restore backup:', error);
      }
    }
  }

  private async generateTasks(stats: TaskMasterStats): Promise<TaskMasterTask[]> {
    const tasks: TaskMasterTask[] = [];

    // Helper to generate task ID
    const generateId = (index: number) => (index + 1).toString();

    // Generate main tasks
    for (let i = 0; i < stats.total; i++) {
      const taskId = generateId(i);
      let status: TaskMasterTask['status'] = 'pending';

      // Assign status based on required counts
      if (i < stats.completed) {
        status = 'done';
      } else if (i < stats.completed + stats.in_progress) {
        status = 'in-progress';
      } else if (i < stats.completed + stats.in_progress + stats.blocked) {
        status = 'blocked';
      } else {
        status = 'pending';
      }

      const task: TaskMasterTask = {
        id: taskId,
        title: `Test Task ${i + 1}`,
        description: `Description for test task ${i + 1}`,
        status,
        priority: this.randomPriority(),
        details: `Implementation details for task ${i + 1}. This task is part of the CCTelegram bridge testing.`,
        testStrategy: `Test strategy for task ${i + 1}. Verify functionality and integration.`,
        createdAt: new Date(Date.now() - Math.random() * 7 * 24 * 60 * 60 * 1000).toISOString(),
        updatedAt: new Date().toISOString(),
        subtasks: []
      };

      tasks.push(task);
    }

    // Add subtasks to achieve the required subtask counts
    const subtasksPerTask = Math.ceil(stats.subtasks_total / stats.total);
    let subtasksCreated = 0;
    let subtasksCompleted = 0;

    for (const task of tasks) {
      if (subtasksCreated >= stats.subtasks_total) break;

      const subtaskCount = Math.min(subtasksPerTask, stats.subtasks_total - subtasksCreated);
      
      for (let j = 0; j < subtaskCount; j++) {
        const subtaskId = `${task.id}.${j + 1}`;
        let subtaskStatus: TaskMasterTask['status'] = 'pending';

        if (subtasksCompleted < stats.subtasks_completed) {
          subtaskStatus = 'done';
          subtasksCompleted++;
        }

        const subtask: TaskMasterTask = {
          id: subtaskId,
          title: `Subtask ${j + 1} of Task ${task.id}`,
          description: `Subtask description for ${subtaskId}`,
          status: subtaskStatus,
          priority: this.randomPriority(),
          details: `Subtask implementation details for ${subtaskId}`,
          createdAt: new Date(Date.now() - Math.random() * 3 * 24 * 60 * 60 * 1000).toISOString(),
          updatedAt: new Date().toISOString()
        };

        task.subtasks!.push(subtask);
        subtasksCreated++;
      }
    }

    return tasks;
  }

  private randomPriority(): 'low' | 'medium' | 'high' {
    const priorities: ('low' | 'medium' | 'high')[] = ['low', 'medium', 'high'];
    return priorities[Math.floor(Math.random() * priorities.length)];
  }

  // Helper method to create data that should show the problematic static values
  async generateStaticProblemData(): Promise<TaskMasterStats> {
    return this.generateLiveTaskData({
      completed: 28,
      total: 29,
      pending: 1,
      in_progress: 0,
      blocked: 0,
      subtasks_completed: 56,
      subtasks_total: 58
    });
  }

  // Helper method to create fresh data that should show in live responses
  async generateFreshTestData(): Promise<TaskMasterStats> {
    return this.generateLiveTaskData({
      completed: 27,
      total: 30,
      pending: 2,
      in_progress: 1,
      blocked: 0,
      subtasks_completed: 45,
      subtasks_total: 50
    });
  }

  // Method to analyze existing TaskMaster data
  async analyzeExistingData(): Promise<{ exists: boolean; stats?: TaskMasterStats; lastUpdated?: string }> {
    const tasksJsonPath = path.join(this.projectRoot, '.taskmaster', 'tasks', 'tasks.json');

    try {
      const content = await fs.readFile(tasksJsonPath, 'utf-8');
      const data = JSON.parse(content) as TaskMasterData;

      const tasks = data.tags?.master?.tasks || [];
      
      const stats = tasks.reduce((acc, task) => {
        acc.total++;
        
        switch (task.status) {
          case 'done':
          case 'completed':
            acc.completed++;
            break;
          case 'pending':
            acc.pending++;
            break;
          case 'in-progress':
            acc.in_progress++;
            break;
          case 'blocked':
            acc.blocked++;
            break;
        }

        if (task.subtasks) {
          task.subtasks.forEach(subtask => {
            acc.subtasks_total++;
            if (subtask.status === 'done' || subtask.status === 'completed') {
              acc.subtasks_completed++;
            }
          });
        }

        return acc;
      }, { 
        total: 0, 
        completed: 0, 
        pending: 0, 
        in_progress: 0, 
        blocked: 0, 
        subtasks_total: 0, 
        subtasks_completed: 0 
      } as TaskMasterStats);

      const lastUpdated = data.tags?.master?.metadata?.updatedAt || 'unknown';

      return {
        exists: true,
        stats,
        lastUpdated
      };

    } catch (error) {
      return {
        exists: false
      };
    }
  }
}