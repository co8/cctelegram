#!/usr/bin/env node

/**
 * CCTelegram Claude Code Commands Installation Script
 * Automatically installs slash commands for CCTelegram mode switching
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

// Command definitions
const commands = {
  'nomad.md': `# CCTelegram Nomad Mode

Switch CCTelegram bridge to nomad mode for remote work with full bidirectional Telegram communication.

## What it does

- Enables comprehensive Telegram notifications and responses
- Optimizes for remote development workflows  
- Provides full bidirectional communication via Telegram
- Enhances interaction capabilities for distributed teams

## Steps

1. Call the MCP function to switch to nomad mode: \`mcp__cctelegram__switch_to_nomad_mode\`
2. Display the success message and current mode status
3. Confirm the bridge is now in nomad mode for remote work

Perfect for when you're working remotely and want maximum Telegram integration.`,

  'native.md': `# CCTelegram Native Mode  

Switch CCTelegram bridge to native mode for local development with minimal Telegram responses.

## What it does

- Reduces Telegram notification overhead for focused local work
- Minimizes distractions during development sessions
- Maintains essential CCTelegram functionality
- Optimizes for local development workflows

## Steps

1. Call the MCP function to switch to native mode: \`mcp__cctelegram__switch_to_native_mode\`
2. Display the success message and current mode status
3. Confirm the bridge is now in native mode for local development

Perfect for when you're working locally and want to minimize Telegram notifications while keeping core functionality active.`,

  'mute.md': `# CCTelegram Mute Mode

Switch CCTelegram bridge to mute mode to disable all Telegram messaging.

## What it does

- Disables all Telegram notifications and responses
- Stops all messaging from CCTelegram to Telegram
- Maintains bridge functionality without any Telegram output
- Perfect for completely silent operation

## Steps

1. Call the MCP function to switch to mute mode: \`mcp__cctelegram__switch_to_mute_mode\`
2. Display the success message and current mode status
3. Confirm the bridge is now in mute mode with all messaging disabled

Ideal for situations when you want CCTelegram to run but with zero Telegram notifications or messages.`
};

const settingsTemplate = {
  commands: {
    "/cct:nomad": {
      description: "Switch CCTelegram to nomad mode (full remote Telegram interaction)", 
      action: "mcp__cctelegram__switch_to_nomad_mode"
    },
    "/cct:native": {
      description: "Switch CCTelegram to native mode (minimal Telegram responses)",
      action: "mcp__cctelegram__switch_to_native_mode"
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
 * Install commands to a specific Claude directory
 */
function installToDirectory(claudeDir, location) {
  const commandsDir = path.join(claudeDir, 'commands');
  const cctDir = path.join(commandsDir, 'cct');
  
  // Create commands/cct directory if it doesn't exist
  if (!fs.existsSync(cctDir)) {
    fs.mkdirSync(cctDir, { recursive: true });
    console.log(`✅ Created cct commands directory: ${cctDir}`);
  }
  
  // Install command files in cct subdirectory
  let installedCount = 0;
  Object.entries(commands).forEach(([filename, content]) => {
    const filePath = path.join(cctDir, filename);
    
    try {
      fs.writeFileSync(filePath, content, 'utf8');
      console.log(`✅ Installed: cct/${filename}`);
      installedCount++;
    } catch (error) {
      console.error(`❌ Failed to install cct/${filename}: ${error.message}`);
    }
  });
  
  // Update or create settings.json
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
    console.log(`✅ Updated settings.json with CCTelegram commands`);
  } catch (error) {
    console.error(`❌ Failed to update settings.json: ${error.message}`);
  }
  
  return installedCount;
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
  
  console.log(`🎉 Installation complete! Installed ${totalInstalled} command files.\n`);
  
  console.log('📋 Available commands after restarting Claude Code:');
  console.log('• /cct:nomad  - Switch to remote mode (full Telegram interaction)');
  console.log('• /cct:native - Switch to native mode (minimal responses)');
  console.log('• /cct:mute   - Switch to mute mode (disable all messaging)\n');
  
  console.log('💡 Remember to restart Claude Code to see the new commands in the command palette.');
}

// Run the installer
if (require.main === module) {
  main();
}

module.exports = { installToDirectory, findClaudeDirectories, commands, settingsTemplate };