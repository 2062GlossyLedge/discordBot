import 'dotenv/config';
import { Client, GatewayIntentBits, Events } from 'discord.js';
import { startScheduler } from './scheduler.js';

// Message storage - in-memory for local development
export const messageStore = [];

// Create Discord client with necessary intents
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

// Bot ready event
client.once(Events.ClientReady, (c) => {
  console.log(`✅ Bot logged in as ${c.user.tag}`);
  console.log(`📊 Monitoring channel: ${process.env.CHANNEL_ID}`);
  console.log(`👤 Sending summaries to user: ${process.env.USER_ID}`);

  // Start the scheduler
  startScheduler(client);
});

// Listen for new messages
client.on(Events.MessageCreate, (message) => {
  // Only track messages from the configured channel
  if (message.channelId !== process.env.CHANNEL_ID) {
    return;
  }

  // Ignore bot messages
  if (message.author.bot) {
    return;
  }

  // Store message data
  const messageData = {
    id: message.id,
    content: message.content,
    author: message.author.username,
    authorId: message.author.id,
    timestamp: message.createdTimestamp,
    channelId: message.channelId,
  };

  messageStore.push(messageData);
  console.log(`📝 Stored message from ${message.author.username}`);

  // Keep only messages from the last configured interval
  const intervalMs = parseInt(process.env.SUMMARY_INTERVAL) * 60 * 60 * 1000;
  const cutoffTime = Date.now() - intervalMs;

  // Remove old messages
  while (messageStore.length > 0 && messageStore[0].timestamp < cutoffTime) {
    messageStore.shift();
  }
});

// Error handling
client.on(Events.Error, (error) => {
  console.error('❌ Discord client error:', error);
});

process.on('unhandledRejection', (error) => {
  console.error('❌ Unhandled promise rejection:', error);
});

// Login to Discord
client.login(process.env.DISCORD_TOKEN);

export { client };
