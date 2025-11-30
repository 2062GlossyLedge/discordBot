/**
 * Cloudflare Worker - Discord Summary Bot (Polling-based)
 * 
 * A stateless worker that fetches messages via Discord REST API,
 * generates a summary, and DMs it to a configured user.
 * 
 * Runs daily at 5pm MST (midnight UTC) via cron trigger.
 * Use /test endpoint to trigger immediately for testing.
 */

const DISCORD_API = 'https://discord.com/api/v10';

export default {
  /**
   * Handle HTTP requests
   */
  async fetch(request, env) {
    const url = new URL(request.url);

    // Health check endpoint
    if (url.pathname === '/health') {
      return new Response('OK', { status: 200 });
    }

    // Test endpoint - triggers summary immediately
    if (url.pathname === '/test') {
      try {
        const result = await generateAndSendSummary(env);
        return new Response(JSON.stringify(result, null, 2), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      } catch (error) {
        return new Response(JSON.stringify({
          error: error.message,
          stack: error.stack,
        }, null, 2), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    }

    return new Response(
      'Discord Summary Bot (Polling)\n\nEndpoints:\n  /health - Health check\n  /test - Trigger summary immediately',
      { status: 200, headers: { 'Content-Type': 'text/plain' } }
    );
  },

  /**
   * Handle scheduled cron triggers (daily at 5pm MST = midnight UTC)
   */
  async scheduled(event, env, ctx) {
    console.log('⏰ Cron triggered at:', new Date().toISOString());
    
    try {
      const result = await generateAndSendSummary(env);
      console.log('✅ Summary sent successfully:', result);
    } catch (error) {
      console.error('❌ Failed to send summary:', error.message);
      throw error; // Re-throw so Cloudflare logs the failure
    }
  },
};

/**
 * Main function: Fetch messages, generate summary, send DM
 */
async function generateAndSendSummary(env) {
  const { DISCORD_TOKEN, CHANNEL_ID, USER_ID, SUMMARY_INTERVAL } = env;

  // Validate required environment variables
  if (!DISCORD_TOKEN) throw new Error('Missing DISCORD_TOKEN');
  if (!CHANNEL_ID) throw new Error('Missing CHANNEL_ID');
  if (!USER_ID) throw new Error('Missing USER_ID');

  const intervalHours = parseInt(SUMMARY_INTERVAL) || 24;
  const cutoffTime = Date.now() - (intervalHours * 60 * 60 * 1000);

  console.log(`📥 Fetching messages from channel ${CHANNEL_ID}...`);

  // Fetch recent messages from the channel
  const messages = await fetchChannelMessages(DISCORD_TOKEN, CHANNEL_ID);

  // Filter to messages within the time window and exclude bots
  const filteredMessages = messages.filter(msg => {
    const msgTime = new Date(msg.timestamp).getTime();
    return msgTime > cutoffTime && !msg.author.bot;
  });

  console.log(`📊 Found ${filteredMessages.length} messages in the last ${intervalHours} hours`);

  // Format the summary
  const summary = formatSummary(filteredMessages, intervalHours);

  // Send summary via DM
  await sendDirectMessage(DISCORD_TOKEN, USER_ID, summary);

  return {
    success: true,
    messagesFound: filteredMessages.length,
    intervalHours,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Fetch messages from a Discord channel via REST API
 */
async function fetchChannelMessages(token, channelId) {
  const response = await fetch(
    `${DISCORD_API}/channels/${channelId}/messages?limit=100`,
    {
      headers: {
        Authorization: `Bot ${token}`,
        'Content-Type': 'application/json',
      },
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Discord API error (${response.status}): ${errorText}`);
  }

  return response.json();
}

/**
 * Format messages into a readable summary
 */
function formatSummary(messages, intervalHours) {
  if (messages.length === 0) {
    return `📭 **No Activity**\n\nNo messages were posted in the last ${intervalHours} hours.`;
  }

  // Sort messages oldest to newest for chronological order
  const sorted = [...messages].sort(
    (a, b) => new Date(a.timestamp) - new Date(b.timestamp)
  );

  let summary = `📊 **Message Summary** (Last ${intervalHours} hours)\n\n`;

  for (const msg of sorted) {
    const time = new Date(msg.timestamp).toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      timeZone: 'America/Denver', // MST
    });

    // Truncate long messages
    const content = msg.content.length > 100
      ? msg.content.substring(0, 100) + '...'
      : msg.content;

    // Handle empty content (embeds, attachments only)
    const displayContent = content || '[attachment/embed]';

    summary += `• **${msg.author.username}** (${time}): ${displayContent}\n`;
  }

  summary += `\n_Total: ${messages.length} message(s)_`;

  return summary;
}

/**
 * Split a message if it exceeds Discord's 2000 character limit
 */
function splitMessage(content, maxLength = 2000) {
  if (content.length <= maxLength) {
    return [content];
  }

  const chunks = [];
  const lines = content.split('\n');
  let currentChunk = '';

  for (const line of lines) {
    // If a single line is too long, truncate it
    const safeLine = line.length > maxLength 
      ? line.substring(0, maxLength - 3) + '...'
      : line;

    if ((currentChunk + '\n' + safeLine).length > maxLength) {
      if (currentChunk) {
        chunks.push(currentChunk.trim());
      }
      currentChunk = safeLine;
    } else {
      currentChunk += (currentChunk ? '\n' : '') + safeLine;
    }
  }

  if (currentChunk) {
    chunks.push(currentChunk.trim());
  }

  return chunks;
}

/**
 * Send a direct message to a user
 */
async function sendDirectMessage(token, userId, content) {
  // First, create/get the DM channel
  const dmChannelResponse = await fetch(`${DISCORD_API}/users/@me/channels`, {
    method: 'POST',
    headers: {
      Authorization: `Bot ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ recipient_id: userId }),
  });

  if (!dmChannelResponse.ok) {
    const errorText = await dmChannelResponse.text();
    if (dmChannelResponse.status === 403) {
      throw new Error(`Cannot DM user ${userId} - they may have DMs disabled`);
    }
    throw new Error(`Failed to create DM channel (${dmChannelResponse.status}): ${errorText}`);
  }

  const dmChannel = await dmChannelResponse.json();

  // Split message if too long
  const chunks = splitMessage(content);

  // Send each chunk
  for (const chunk of chunks) {
    const sendResponse = await fetch(
      `${DISCORD_API}/channels/${dmChannel.id}/messages`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bot ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ content: chunk }),
      }
    );

    if (!sendResponse.ok) {
      const errorText = await sendResponse.text();
      throw new Error(`Failed to send message (${sendResponse.status}): ${errorText}`);
    }
  }

  console.log(`✅ Sent ${chunks.length} message(s) to user ${userId}`);
}
