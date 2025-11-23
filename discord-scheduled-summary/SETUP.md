# Quick Setup Guide

## Step 1: Discord Bot Registration

1. Go to https://discord.com/developers/applications
2. Click "New Application" and give it a name
3. Go to "Bot" section → Click "Add Bot"
4. Under "Privileged Gateway Intents", enable:
   - ✅ MESSAGE CONTENT INTENT (Required!)
   - ✅ SERVER MEMBERS INTENT (Optional)
5. Click "Reset Token" → Copy the token (save this!)
6. Go to "General Information" → Copy Application ID
7. Go to "OAuth2" → "URL Generator"
   - Scopes: `bot`, `applications.commands`
   - Bot Permissions:
     - Read Messages/View Channels
     - Read Message History
     - Send Messages
8. Copy generated URL and open in browser to invite bot to your server

## Step 2: Get Discord IDs

1. Enable Developer Mode: Discord Settings → Advanced → Developer Mode ✅
2. Right-click your server → Copy Server ID (GUILD_ID)
3. Right-click channel to monitor → Copy Channel ID (CHANNEL_ID)
4. Right-click your username → Copy User ID (USER_ID)

## Step 3: Local Development Setup

```bash
cd discord-scheduled-summary
cp .env.sample .env
```

Edit `.env` with your values:
```env
DISCORD_TOKEN=YOUR_BOT_TOKEN_FROM_STEP_1
APP_ID=YOUR_APPLICATION_ID_FROM_STEP_1
GUILD_ID=YOUR_GUILD_ID
CHANNEL_ID=YOUR_CHANNEL_ID
USER_ID=YOUR_USER_ID
SUMMARY_TIME=0 9 * * *
SUMMARY_INTERVAL=24
```

## Step 4: Test Locally

```bash
# Install dependencies (already done)
npm install

# Test with immediate summary (10 seconds after start)
# Add TEST_IMMEDIATE=true to .env first
npm start

# Or run normally with scheduled summaries
npm start
```

## Step 5: Deploy to Cloudflare Workers

```bash
# Install Wrangler globally
npm install -g wrangler

# Login to Cloudflare
wrangler login

# Set secrets (one at a time)
wrangler secret put DISCORD_TOKEN
wrangler secret put APP_ID
wrangler secret put GUILD_ID
wrangler secret put CHANNEL_ID
wrangler secret put USER_ID
wrangler secret put SUMMARY_INTERVAL
wrangler secret put SUMMARY_TIME_HOUR

# Deploy
npm run deploy

# Start the bot (triggers connection)
curl https://discord-scheduled-summary.YOUR_SUBDOMAIN.workers.dev/start

# Check status
curl https://discord-scheduled-summary.YOUR_SUBDOMAIN.workers.dev/status
```

## Verification Checklist

- [ ] Bot token is valid and copied correctly
- [ ] MESSAGE CONTENT INTENT is enabled in Discord portal
- [ ] Bot is invited to your server with correct permissions
- [ ] CHANNEL_ID points to a channel the bot can access
- [ ] USER_ID is your Discord user ID (not username)
- [ ] Bot appears online in your server member list
- [ ] For local: npm start runs without errors
- [ ] For Cloudflare: /status endpoint shows connected: true

## Common Issues

**"Missing Access" error**: Bot doesn't have View Channel permission
**No messages stored**: MESSAGE CONTENT INTENT not enabled
**Can't send DM**: You blocked the bot or have DMs disabled
**Bot offline**: Token is invalid or bot not started
