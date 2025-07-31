#!/bin/bash

echo "CC Telegram Bridge Test Script"
echo "================================"

# Set up environment variables for testing
export TELEGRAM_BOT_TOKEN="dummy_token_for_testing"
export TELEGRAM_ALLOWED_USERS="297126051"

echo "Environment set up:"
echo "  TELEGRAM_BOT_TOKEN: ${TELEGRAM_BOT_TOKEN:0:10}..."
echo "  TELEGRAM_ALLOWED_USERS: $TELEGRAM_ALLOWED_USERS"
echo ""

# Build the application
echo "Building application..."
cargo build --release

if [ $? -eq 0 ]; then
    echo "✅ Build successful!"
else
    echo "❌ Build failed!"
    exit 1
fi

echo ""
echo "🚀 Application ready for testing!"
echo ""
echo "To run the application:"
echo "  export TELEGRAM_BOT_TOKEN='your_real_bot_token'"
echo "  export TELEGRAM_ALLOWED_USERS='297126051'"
echo "  ./target/release/cc-telegram-bridge"
echo ""
echo "Configuration will be created at ~/.cc_telegram/config.toml"
echo "Event files should be placed in ~/.cc_telegram/events/"