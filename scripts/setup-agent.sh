#!/bin/bash
# CCTelegram Agent Setup Script
# Installs and configures the specialized communication agent

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
SERVICE_NAME="cctelegram-agent"

echo "🤖 Setting up CCTelegram Communication Agent..."

# Check if Node.js is available
if ! command -v node &> /dev/null; then
    echo "❌ Node.js not found. Please install Node.js 16+ first."
    exit 1
fi

# Check Node.js version
NODE_VERSION=$(node --version | cut -d'v' -f2 | cut -d'.' -f1)
if [[ $NODE_VERSION -lt 16 ]]; then
    echo "❌ Node.js version 16+ required. Current version: $(node --version)"
    exit 1
fi

# Make agent executable
chmod +x "$SCRIPT_DIR/cctelegram-agent.js"

# Test the agent
echo "🧪 Testing agent functionality..."
if ! node "$SCRIPT_DIR/cctelegram-agent.js" --help &> /dev/null; then
    echo "⚠️ Agent test failed, but continuing with setup..."
fi

# Ask user about installation method
echo ""
echo "Choose installation method:"
echo "1) Run manually (recommended for development)"
echo "2) Install as systemd service (recommended for production)"
echo "3) Install as user cron job"
read -p "Enter choice [1-3]: " choice

case $choice in
    1)
        echo "📋 Manual installation selected"
        echo ""
        echo "To run the agent manually:"
        echo "  node $SCRIPT_DIR/cctelegram-agent.js"
        echo ""
        echo "To run with custom settings:"
        echo "  node $SCRIPT_DIR/cctelegram-agent.js [projectRoot] [updateInterval] [maxMessagesPerHour]"
        echo ""
        echo "Example:"
        echo "  node $SCRIPT_DIR/cctelegram-agent.js $PROJECT_ROOT 180000 8"
        ;;
        
    2)
        echo "⚙️ Installing as systemd service..."
        
        # Create the service file with correct paths
        cat > "/tmp/$SERVICE_NAME.service" << EOF
[Unit]
Description=CCTelegram Communication Agent
Documentation=https://github.com/co8/cctelegram
After=network.target

[Service]
Type=simple
User=$USER
Group=$(id -gn)
WorkingDirectory=$PROJECT_ROOT
ExecStart=$(which node) $SCRIPT_DIR/cctelegram-agent.js $PROJECT_ROOT
ExecReload=/bin/kill -HUP \$MAINPID

# Environment
Environment=NODE_ENV=production
Environment=MCP_SERVER_URL=http://localhost:3000

# Resource limits
LimitNOFILE=4096

# Restart policy
Restart=always
RestartSec=10
StartLimitInterval=60s
StartLimitBurst=3

# Logging
StandardOutput=journal
StandardError=journal
SyslogIdentifier=$SERVICE_NAME

[Install]
WantedBy=multi-user.target
EOF

        # Install the service
        if [[ $EUID -eq 0 ]]; then
            # Running as root
            cp "/tmp/$SERVICE_NAME.service" "/etc/systemd/system/"
            systemctl daemon-reload
            systemctl enable "$SERVICE_NAME"
            
            echo "✅ Service installed successfully!"
            echo ""
            echo "To start the service:"
            echo "  sudo systemctl start $SERVICE_NAME"
            echo ""
            echo "To check status:"
            echo "  sudo systemctl status $SERVICE_NAME"
            echo ""
            echo "To view logs:"
            echo "  sudo journalctl -u $SERVICE_NAME -f"
            
        else
            # Running as regular user - use user systemd
            mkdir -p "$HOME/.config/systemd/user"
            cp "/tmp/$SERVICE_NAME.service" "$HOME/.config/systemd/user/"
            systemctl --user daemon-reload
            systemctl --user enable "$SERVICE_NAME"
            
            echo "✅ User service installed successfully!"
            echo ""
            echo "To start the service:"
            echo "  systemctl --user start $SERVICE_NAME"
            echo ""
            echo "To check status:"
            echo "  systemctl --user status $SERVICE_NAME"
            echo ""
            echo "To view logs:"
            echo "  journalctl --user -u $SERVICE_NAME -f"
        fi
        
        rm "/tmp/$SERVICE_NAME.service"
        ;;
        
    3)
        echo "⏰ Installing as cron job..."
        
        # Create a wrapper script for cron
        cat > "$SCRIPT_DIR/cctelegram-agent-cron.sh" << EOF
#!/bin/bash
# CCTelegram Agent Cron Wrapper
cd "$PROJECT_ROOT"
node "$SCRIPT_DIR/cctelegram-agent.js" "$PROJECT_ROOT" 1800000 6  # 30 min intervals, 6 msgs/hour
EOF
        
        chmod +x "$SCRIPT_DIR/cctelegram-agent-cron.sh"
        
        # Add to crontab (run every 30 minutes during working hours)
        (crontab -l 2>/dev/null; echo "*/30 9-18 * * 1-5 $SCRIPT_DIR/cctelegram-agent-cron.sh") | crontab -
        
        echo "✅ Cron job installed successfully!"
        echo "Agent will run every 30 minutes during working hours (9 AM - 6 PM, Mon-Fri)"
        echo ""
        echo "To view cron jobs:"
        echo "  crontab -l"
        echo ""
        echo "To remove cron job:"
        echo "  crontab -e  # then delete the cctelegram-agent line"
        ;;
        
    *)
        echo "❌ Invalid choice"
        exit 1
        ;;
esac

echo ""
echo "🎉 CCTelegram Agent setup completed!"
echo ""
echo "📡 The agent will monitor:"
echo "  • Task Master progress (if available)"
echo "  • Git commit activity"
echo "  • Build/dependency changes"
echo "  • System health status"
echo "  • Project development metrics"
echo ""
echo "⚙️ Configuration:"
echo "  • Project root: $PROJECT_ROOT"
echo "  • MCP server: http://localhost:3000"
echo "  • Working hours: 9 AM - 6 PM"
echo "  • Max messages: 12 per hour"
echo ""
echo "🔧 To customize settings, edit the agent configuration in:"
echo "  $SCRIPT_DIR/cctelegram-agent.js"