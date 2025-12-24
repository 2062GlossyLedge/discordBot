/**
 * Cloudflare Worker - Discord Summary Bot (Polling-based)
 * 
 * A stateless worker that fetches messages via Discord REST API,
 * generates a summary, and DMs it to a configured user.
 * 
 * Runs daily at 5pm MST (midnight UTC) via cron trigger.
 * Use /test endpoint to trigger immediately for testing.
 * Use /stop to disable and /start to enable the scheduled summary.
 */

const DISCORD_API = 'https://discord.com/api/v10';
const BOT_ENABLED_KEY = 'bot_enabled';

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

        // Status endpoint - check if bot is enabled
        if (url.pathname === '/status') {
            const enabled = await isBotEnabled(env);
            return new Response(JSON.stringify({
                enabled,
                message: enabled ? 'Bot is enabled and will send scheduled summaries' : 'Bot is disabled',
            }, null, 2), {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
            });
        }

        // Stop endpoint - disable scheduled summaries
        if (url.pathname === '/stop') {
            await env.BOT_STATE.put(BOT_ENABLED_KEY, 'false');
            return new Response(JSON.stringify({
                success: true,
                enabled: false,
                message: 'Bot disabled. Scheduled summaries will not run until /start is called.',
            }, null, 2), {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
            });
        }

        // Start endpoint - enable scheduled summaries
        if (url.pathname === '/start') {
            await env.BOT_STATE.put(BOT_ENABLED_KEY, 'true');
            return new Response(JSON.stringify({
                success: true,
                enabled: true,
                message: 'Bot enabled. Scheduled summaries will run at 5pm MST daily.',
            }, null, 2), {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
            });
        }

        // Test endpoint - triggers summary immediately (bypasses enabled check)
        if (url.pathname === '/test') {
            try {
                const result = await testWithLongMessages(env);
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
            'Discord Summary Bot (Polling)\n\nEndpoints:\n  /health - Health check\n  /status - Check if bot is enabled\n  /start - Enable scheduled summaries\n  /stop - Disable scheduled summaries\n  /test - Trigger summary immediately (ignores enabled state)',
            { status: 200, headers: { 'Content-Type': 'text/plain' } }
        );
    },

    /**
     * Handle scheduled cron triggers (daily at 5pm MST = midnight UTC)
     */
    async scheduled(event, env, ctx) {
        console.log('⏰ Cron triggered at:', new Date().toISOString());

        // Check if bot is enabled
        const enabled = await isBotEnabled(env);
        if (!enabled) {
            console.log('⏸️ Bot is disabled, skipping summary');
            return;
        }

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
 * Check if the bot is enabled (defaults to true if not set)
 */
async function isBotEnabled(env) {
    const value = await env.BOT_STATE.get(BOT_ENABLED_KEY);
    // Default to enabled if not set
    return value !== 'false';
}

/**
 * Test function with long messages to exceed Discord's 2000 character limit
 */
async function testWithLongMessages(env) {
    const { USER_ID, DISCORD_TOKEN } = env;

    // Create mock messages with long content to test splitting
    const longText = 'Lorem ipsum dolor sit amet, consectetur adipiscing elit. '.repeat(50); // ~2800 chars

    const mockMessages = [
        {
            id: '1',
            content: longText,
            author: { username: 'User1', bot: false },
            timestamp: new Date(Date.now() - 3600000).toISOString(),
        },
        {
            id: '2',
            content: 'Another message with ' + longText.substring(0, 500),
            author: { username: 'User2', bot: false },
            timestamp: new Date(Date.now() - 1800000).toISOString(),
        },
        {
            id: '3',
            content: 'Short message',
            author: { username: 'User3', bot: false },
            timestamp: new Date(Date.now() - 900000).toISOString(),
        },
    ];

    // Format the summary with long content
    const summary = formatSummary(mockMessages, 24);

    console.log(`📊 Test summary length: ${summary.length} characters`);
    console.log(`📧 Sending test summary to user ${USER_ID}...`);

    // Send the test summary via DM
    await sendDirectMessage(DISCORD_TOKEN, USER_ID, summary);

    return {
        success: true,
        messagesGenerated: mockMessages.length,
        summaryLength: summary.length,
        timestamp: new Date().toISOString(),
        note: 'Test with long messages to verify message splitting',
    };
}

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

        // Handle empty content (embeds, attachments only)
        const displayContent = msg.content || '[attachment/embed]';

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

        // append next text to chunk until it reached limit. adds digestable chunks to array, 
        if ((currentChunk + '\n' + safeLine).length > maxLength) {
            if (currentChunk) {
                chunks.push(currentChunk.trim());
            }
            currentChunk = safeLine;
            //handle empty currentChunk
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
