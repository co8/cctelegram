#!/usr/bin/env node

/**
 * CCTelegram Claude Code Commands Installation Script
 * Automatically installs slash commands for CCTelegram mode switching
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

// User-level command definitions (no project-level files created)
const commands = {};

const settingsTemplate = {
  commands: {
    "/cct:nomad": {
      description: "Switch CCTelegram to nomad mode (full remote Telegram interaction)", 
      action: "mcp__cctelegram__switch_to_nomad_mode"
    },
    "/cct:local": {
      description: "Switch CCTelegram to local mode (minimal Telegram responses)",
      action: "mcp__cctelegram__switch_to_local_mode"
    },
    "/cct:mute": {
      description: "Switch CCTelegram to mute mode (disable all Telegram messaging)",
      action: "mcp__cctelegram__switch_to_mute_mode"
    }
  }
};

/**
 * Find Claude Code configuration directories
 */
function findClaudeDirectories() {
  const homeDir = os.homedir();
  const possiblePaths = [
    path.join(homeDir, '.claude'),
    path.join(homeDir, '.config', 'claude'),
  ];
  
  // Check current project directory for .claude
  const currentProject = process.cwd();
  const projectClaude = path.join(currentProject, '.claude');
  
  const foundPaths = [];
  
  // Check if current project has .claude directory
  if (fs.existsSync(projectClaude)) {
    foundPaths.push({ path: projectClaude, type: 'project', location: currentProject });
  }
  
  // Check global directories
  possiblePaths.forEach(claudePath => {
    if (fs.existsSync(claudePath)) {
      foundPaths.push({ path: claudePath, type: 'global', location: claudePath });
    }
  });
  
  return foundPaths;
}

/**
 * Install commands to a specific Claude directory (user-level only)
 */
function installToDirectory(claudeDir, location) {
  // Only update settings.json for user-level commands
  const settingsPath = path.join(claudeDir, 'settings.json');
  let existingSettings = {};
  
  if (fs.existsSync(settingsPath)) {
    try {
      const settingsContent = fs.readFileSync(settingsPath, 'utf8');
      existingSettings = JSON.parse(settingsContent);
      console.log(`📄 Found existing settings.json`);
    } catch (error) {
      console.warn(`⚠️  Could not parse existing settings.json: ${error.message}`);
    }
  }
  
  // Merge settings
  const mergedSettings = {
    ...existingSettings,
    commands: {
      ...existingSettings.commands,
      ...settingsTemplate.commands
    }
  };
  
  try {
    fs.writeFileSync(settingsPath, JSON.stringify(mergedSettings, null, 2), 'utf8');
    console.log(`✅ Updated settings.json with CCTelegram user-level commands`);
    return 3; // Return count of user-level commands added
  } catch (error) {
    console.error(`❌ Failed to update settings.json: ${error.message}`);
    return 0;
  }
}

/**
 * Main installation function
 */
function main() {
  console.log('🚀 CCTelegram Claude Code Commands Installer\n');
  
  const claudeDirectories = findClaudeDirectories();
  
  if (claudeDirectories.length === 0) {
    console.log('❌ No Claude Code directories found.');
    console.log('\nTo create a project-specific installation:');
    console.log('1. Run this script from your project directory');
    console.log('2. Or create a .claude directory manually');
    process.exit(1);
  }
  
  console.log(`Found ${claudeDirectories.length} Claude Code installation(s):\n`);
  
  let totalInstalled = 0;
  
  claudeDirectories.forEach((dir, index) => {
    console.log(`📁 [${index + 1}] ${dir.type.toUpperCase()}: ${dir.location}`);
    const installed = installToDirectory(dir.path, dir.location);
    totalInstalled += installed;
    console.log('');
  });
  
  console.log(`🎉 Installation complete! Updated ${totalInstalled > 0 ? claudeDirectories.length : 0} Claude settings file(s).\n`);
  
  console.log('📋 Available user-level commands after restarting Claude Code:');
  console.log('• /cct:mute   - Switch to mute mode (disable all messaging)');
  console.log('• /cct:local  - Switch to local mode (minimal responses)');
  console.log('• /cct:nomad  - Switch to nomad mode (full Telegram interaction)\n');
  
  console.log('💡 Remember to restart Claude Code to see the updated commands in the command palette.');
}

// Run the installer
if (require.main === module) {
  main();
}

module.exports = { installToDirectory, findClaudeDirectories, commands, settingsTemplate };