# Discord Scheduled Message Summary Bot

A Discord bot that monitors guild messages and sends you scheduled summaries via DM. Available in two deployment modes: local Node.js or Cloudflare Workers with Durable Objects.

## Features

- 📊 Monitors messages from a specific Discord channel
- ⏰ Sends scheduled summaries at configurable times
- 💬 Delivers summaries via Discord DM
- 🔒 Filters out bot messages automatically
- ⚡ Two deployment options: Local or Cloudflare Workers

## Prerequisites

1. **Discord Bot Setup**:
   - Go to [Discord Developer Portal](https://discord.com/developers/applications)
   - Create a new application
   - Go to "Bot" section and create a bot
   - Copy the bot token
   - Enable these **Privileged Gateway Intents**:
     - `MESSAGE CONTENT INTENT` ✅ (Required)
     - `SERVER MEMBERS INTENT` (Optional)
   - Copy your Application ID from "General Information"

2. **Bot Permissions**:
   - Generate an invite URL with these permissions:
     - `View Channels`
     - `Read Message History`
     - `Send Messages`
   - Bot scopes: `bot`, `applications.commands`
   - Invite the bot to your server using the generated URL

3. **Get Required IDs**:
   - Enable Developer Mode in Discord (Settings → Advanced → Developer Mode)
   - Right-click your server → Copy ID (Guild ID)
   - Right-click the channel to monitor → Copy ID (Channel ID)
   - Right-click your username → Copy ID (User ID)

## Installation

### Clone and Install Dependencies

```bash
cd discord-scheduled-summary
npm install
```

### Configure Environment Variables

Copy `.env.sample` to `.env` and fill in your values:

```bash
cp .env.sample .env
```

Edit `.env`:
```env
DISCORD_TOKEN=your_bot_token_here
APP_ID=your_app_id_here
GUILD_ID=your_guild_id_here
CHANNEL_ID=your_channel_id_here
USER_ID=your_user_id_here

# Cron format: "minute hour day month weekday"
# Examples:
#   "0 9 * * *"   = Every day at 9:00 AM
#   "0 */6 * * *" = Every 6 hours
#   "0 18 * * 1-5" = Weekdays at 6:00 PM
SUMMARY_TIME=0 9 * * *

# Hours to look back for messages
SUMMARY_INTERVAL=24
```

## Running Locally

### Start the Bot

```bash
npm start
```

Or with auto-restart on file changes:
```bash
npm run dev
```

### Test Mode

To receive an immediate summary (after 10 seconds) for testing:

Add to your `.env`:
```env
TEST_IMMEDIATE=true
```

Then start the bot:
```bash
npm start
```

## Deploying to Cloudflare Workers

### Prerequisites

1. **Cloudflare Account**: [Sign up](https://dash.cloudflare.com/sign-up)
2. **Wrangler CLI**: Install globally
   ```bash
   npm install -g wrangler
   ```
3. **Authenticate Wrangler**:
   ```bash
   wrangler login
   ```

### Configure Secrets

Set your environment variables as Cloudflare secrets:

```bash
wrangler secret put DISCORD_TOKEN
# Paste your bot token when prompted

wrangler secret put APP_ID
wrangler secret put GUILD_ID
wrangler secret put CHANNEL_ID
wrangler secret put USER_ID
wrangler secret put SUMMARY_INTERVAL
# Enter: 24

wrangler secret put SUMMARY_TIME_HOUR
# Enter: 9 (for 9:00 AM UTC)
```

### Deploy

```bash
npm run deploy
# or
wrangler deploy
```

### Start the Bot

After deployment, trigger the bot to connect:

```bash
curl https://discord-scheduled-summary.YOUR_SUBDOMAIN.workers.dev/start
```

Check status:
```bash
curl https://discord-scheduled-summary.YOUR_SUBDOMAIN.workers.dev/status
```

### Cloudflare Worker Notes

- The bot runs in a **Durable Object** for persistent WebSocket connections
- Uses **Durable Object Alarms** for scheduling (no cron needed)
- Automatically reconnects if disconnected
- Messages are stored in Durable Object storage

## Architecture

### Local Mode (`bot.js` + `scheduler.js`)
- Uses `discord.js` library
- Node.js cron scheduling with `node-cron`
- In-memory message storage
- Simple and easy to debug

### Cloudflare Workers Mode (`worker.js`)
- Direct WebSocket connection to Discord Gateway
- Durable Objects for state persistence
- Alarm-based scheduling
- Distributed and scalable
- No server maintenance required

## Usage

Once running, the bot will:
1. Monitor messages in the configured channel
2. Store messages for the configured time span
3. At the scheduled time, format a summary
4. Send the summary to you via DM

### Summary Format

```
📊 **Message Summary** (Last 24 hours)

• **Username1** (09:15): Message content here...
• **Username2** (10:30): Another message...
• **Username3** (14:45): More content...

_Total: 3 messages_
```

## Troubleshooting

### Bot doesn't connect
- Verify your `DISCORD_TOKEN` is correct
- Check that Privileged Intents are enabled in Discord Developer Portal
- Ensure the bot is invited to your server

### No messages stored
- Verify `CHANNEL_ID` is correct
- Check bot has `View Channels` and `Read Message History` permissions
- Ensure `MESSAGE CONTENT INTENT` is enabled

### No DM received
- Verify `USER_ID` is your Discord user ID
- Check you haven't blocked the bot
- Ensure bot has `Send Messages` permission
- Check bot logs for errors

### Cloudflare Worker issues
- Check worker logs: `wrangler tail`
- Verify all secrets are set: `wrangler secret list`
- Ensure Durable Objects are enabled in your account
- Check `/status` endpoint for connection state

## Development

### Project Structure

```
discord-scheduled-summary/
├── bot.js              # Local: Discord.js Gateway client
├── scheduler.js        # Local: Cron-based scheduling
├── worker.js           # Cloudflare: Worker + Durable Object
├── wrangler.toml       # Cloudflare configuration
├── package.json        # Dependencies
├── .env                # Local environment variables
├── .env.sample         # Environment template
└── README.md           # This file
```

### Extending the Bot

**Add filtering logic** (e.g., ignore mentions of you):
- Edit `handleMessageCreate` in `bot.js` or `worker.js`
- Add conditions before storing messages

**Change summary format**:
- Edit `formatSummary` function in `scheduler.js` or `worker.js`

**Add commands**:
- Implement slash commands using Discord Interactions
- See [Discord.js Guide](https://discordjs.guide/)

## License

MIT

## Resources

- [Discord Developer Portal](https://discord.com/developers/docs)
- [Discord.js Guide](https://discordjs.guide/)
- [Cloudflare Workers Docs](https://developers.cloudflare.com/workers/)
- [Durable Objects](https://developers.cloudflare.com/workers/runtime-apis/durable-objects/)
