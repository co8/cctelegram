# CCTelegram Mute Mode

Switch CCTelegram bridge to mute mode to disable all Telegram messaging.

## What it does

- Disables all Telegram notifications and responses
- Stops all messaging from CCTelegram to Telegram
- Maintains bridge functionality without any Telegram output
- Perfect for completely silent operation

## Steps

1. Call the MCP function to switch to mute mode: `mcp__cctelegram__switch_to_mute_mode`
2. Display the success message and current mode status
3. Confirm the bridge is now in mute mode with all messaging disabled

Ideal for situations when you want CCTelegram to run but with zero Telegram notifications or messages.