import 'dotenv/config';
import cron from 'node-cron';
import { messageStore } from './bot.js';

/**
 * Start the scheduler to send periodic summaries
 * @param {Client} client - Discord.js client instance
 */
export function startScheduler(client) {
  const scheduleTime = process.env.SUMMARY_TIME || '0 9 * * *';
  
  console.log(`⏰ Scheduler started with cron: ${scheduleTime}`);
  
  // Schedule the summary job
  cron.schedule(scheduleTime, async () => {
    console.log('🔔 Triggering scheduled summary...');
    await sendSummary(client);
  });

  // Also allow manual trigger for testing (run once after 10 seconds)
  if (process.env.TEST_IMMEDIATE === 'true') {
    setTimeout(async () => {
      console.log('🧪 Test mode: Sending immediate summary...');
      await sendSummary(client);
    }, 10000);
  }
}

/**
 * Generate and send the message summary to the configured user
 * @param {Client} client - Discord.js client instance
 */
async function sendSummary(client) {
  try {
    const userId = process.env.USER_ID;
    const intervalHours = parseInt(process.env.SUMMARY_INTERVAL);
    
    // Get messages from the last interval
    const now = Date.now();
    const intervalMs = intervalHours * 60 * 60 * 1000;
    const cutoffTime = now - intervalMs;
    
    const recentMessages = messageStore.filter(msg => msg.timestamp >= cutoffTime);
    
    console.log(`📬 Found ${recentMessages.length} messages in the last ${intervalHours} hours`);
    
    if (recentMessages.length === 0) {
      console.log('ℹ️ No messages to summarize, skipping DM');
      return;
    }
    
    // Format the summary
    const summary = formatSummary(recentMessages, intervalHours);
    
    // Get or create DM channel with the user
    const user = await client.users.fetch(userId);
    const dmChannel = await user.createDM();
    
    // Send the summary (split if too long)
    await sendLongMessage(dmChannel, summary);
    
    console.log(`✅ Summary sent to ${user.username}`);
  } catch (error) {
    console.error('❌ Error sending summary:', error);
  }
}

/**
 * Format messages into a bullet-point summary
 * @param {Array} messages - Array of message objects
 * @param {number} hours - Time span in hours
 * @returns {string} Formatted summary
 */
function formatSummary(messages, hours) {
  const header = `📊 **Message Summary** (Last ${hours} hours)\n`;
  const footer = `\n\n_Total: ${messages.length} message${messages.length !== 1 ? 's' : ''}_`;
  
  let body = '';
  
  for (const msg of messages) {
    const timestamp = new Date(msg.timestamp).toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
    });
    
    // Truncate long messages
    let content = msg.content;
    if (content.length > 100) {
      content = content.substring(0, 97) + '...';
    }
    
    // Handle empty content (e.g., attachments only)
    if (!content.trim()) {
      content = '_[attachment or embed]_';
    }
    
    body += `• **${msg.author}** (${timestamp}): ${content}\n`;
  }
  
  return header + '\n' + body + footer;
}

/**
 * Send a message that might exceed Discord's character limit
 * Splits into multiple messages if necessary
 * @param {DMChannel} channel - DM channel to send to
 * @param {string} content - Message content
 */
async function sendLongMessage(channel, content) {
  const maxLength = 2000;
  
  if (content.length <= maxLength) {
    await channel.send(content);
    return;
  }
  
  // Split into chunks
  const lines = content.split('\n');
  let currentChunk = '';
  
  for (const line of lines) {
    if ((currentChunk + line + '\n').length > maxLength) {
      if (currentChunk) {
        await channel.send(currentChunk);
        currentChunk = '';
      }
      
      // If a single line is too long, truncate it
      if (line.length > maxLength) {
        await channel.send(line.substring(0, maxLength - 3) + '...');
      } else {
        currentChunk = line + '\n';
      }
    } else {
      currentChunk += line + '\n';
    }
  }
  
  if (currentChunk) {
    await channel.send(currentChunk);
  }
}
