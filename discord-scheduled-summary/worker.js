/**
 * Cloudflare Worker with Durable Objects for Discord Gateway Bot
 * This implementation maintains a persistent WebSocket connection to Discord
 * and schedules message summaries using Durable Object Alarms
 */

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Health check endpoint
    if (url.pathname === '/health') {
      return new Response('OK', { status: 200 });
    }

    // Get or create the Durable Object instance
    const id = env.DISCORD_BOT.idFromName('main-bot');
    const stub = env.DISCORD_BOT.get(id);

    // Route requests to the Durable Object
    if (url.pathname === '/start') {
      return stub.fetch(request);
    }

    if (url.pathname === '/status') {
      return stub.fetch(request);
    }

    return new Response('Discord Summary Bot - Endpoints: /start, /status, /health', {
      status: 200,
    });
  },
};

export class DiscordBot {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.ws = null;
    this.heartbeatInterval = null;
    this.sessionId = null;
    this.sequenceNumber = null;
    this.messageStore = [];
    this.reconnectAttempts = 0;
    this.isConnecting = false;
    this.reconnectTimeout = null;
  }

  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname === '/start') {
      await this.connectToGateway();
      return new Response('Bot started', { status: 200 });
    }

    if (url.pathname === '/status') {
      const status = {
        connected: this.ws !== null && this.ws.readyState === WebSocket.OPEN,
        wsReadyState: this.ws ? this.ws.readyState : null,
        sessionId: this.sessionId,
        messagesStored: this.messageStore.length,
        reconnectAttempts: this.reconnectAttempts,
        isConnecting: this.isConnecting,
        hasReconnectScheduled: this.reconnectTimeout !== null,
      };
      return new Response(JSON.stringify(status, null, 2), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response('Unknown endpoint', { status: 404 });
  }
  //connect on Gateway
  async connectToGateway() {
    if (this.ws) {
      console.log('Already connected to Gateway');
      return;
    }

    if (this.isConnecting) {
      console.log('Connection attempt already in progress');
      return;
    }

    this.isConnecting = true;

    try {
      // Get Gateway URL
      const gatewayResponse = await fetch('https://discord.com/api/v10/gateway/bot', {
        headers: {
          Authorization: `Bot ${this.env.DISCORD_TOKEN}`,
        },
      });

      const gatewayData = await gatewayResponse.json();
      const gatewayUrl = gatewayData.url;

      // Connect to WebSocket
      this.ws = new WebSocket(`${gatewayUrl}/?v=10&encoding=json`);

      this.ws.addEventListener('open', () => {
        console.log('WebSocket connection opened');
        this.reconnectAttempts = 0; // Reset on successful connection
        this.isConnecting = false;
      });

      this.ws.addEventListener('message', async (event) => {
        await this.handleGatewayMessage(JSON.parse(event.data));
      });

      this.ws.addEventListener('close', (event) => {
        console.log('WebSocket closed:', event.code, event.reason);
        this.cleanup();

        // Exponential backoff: 5s, 10s, 20s, 40s, 60s (max)
        this.reconnectAttempts++;
        const delay = Math.min(5000 * Math.pow(2, this.reconnectAttempts - 1), 60000);
        console.log(`Reconnecting in ${delay / 1000}s (attempt ${this.reconnectAttempts})`);

        this.reconnectTimeout = setTimeout(() => this.connectToGateway(), delay);
      });

      this.ws.addEventListener('error', (error) => {
        console.error('WebSocket error:', error);
        this.isConnecting = false;
      });

    } catch (error) {
      console.error('Failed to connect to Gateway:', error);
      this.isConnecting = false;

      // Exponential backoff for fetch errors too
      this.reconnectAttempts++;
      const delay = Math.min(5000 * Math.pow(2, this.reconnectAttempts - 1), 60000);
      console.log(`Retrying in ${delay / 1000}s (attempt ${this.reconnectAttempts})`);

      this.reconnectTimeout = setTimeout(() => this.connectToGateway(), delay);
    }
  }

  async handleGatewayMessage(data) {
    const { op, t, s, d } = data;

    // Update sequence number
    if (s !== null) {
      this.sequenceNumber = s;
    }

    switch (op) {
      case 10: // Hello
        this.startHeartbeat(d.heartbeat_interval);
        await this.identify();

        // Set up alarm for scheduled summary
        await this.scheduleNextSummary();
        break;

      case 0: // Dispatch
        await this.handleEvent(t, d);
        break;

      case 1: // Heartbeat request
        this.sendHeartbeat();
        break;

      case 11: // Heartbeat ACK
        console.log('Heartbeat acknowledged');
        break;

      default:
        console.log('Unknown opcode:', op);
    }
  }

  startHeartbeat(interval) {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
    }

    this.heartbeatInterval = setInterval(() => {
      this.sendHeartbeat();
    }, interval);
  }

  sendHeartbeat() {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({
        op: 1,
        d: this.sequenceNumber,
      }));
    }
  }

  async identify() {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    this.ws.send(JSON.stringify({
      op: 2,
      d: {
        token: this.env.DISCORD_TOKEN,
        intents: 513, // GUILDS (1) + GUILD_MESSAGES (512)
        properties: {
          os: 'linux',
          browser: 'cloudflare-worker',
          device: 'cloudflare-worker',
        },
      },
    }));
  }

  async handleEvent(eventType, data) {
    switch (eventType) {
      case 'READY':
        console.log('Bot is ready!');
        this.sessionId = data.session_id;
        break;

      case 'MESSAGE_CREATE':
        await this.handleMessageCreate(data);
        break;
    }
  }

  async handleMessageCreate(message) {
    // Only track messages from configured channel
    if (message.channel_id !== this.env.CHANNEL_ID) {
      return;
    }

    // Ignore bot messages
    if (message.author.bot) {
      return;
    }

    // Store message
    const messageData = {
      id: message.id,
      content: message.content,
      author: message.author.username,
      authorId: message.author.id,
      timestamp: Date.now(),
      channelId: message.channel_id,
    };

    this.messageStore.push(messageData);
    console.log(`Stored message from ${message.author.username}`);

    // Keep only recent messages
    const intervalMs = parseInt(this.env.SUMMARY_INTERVAL) * 60 * 60 * 1000;
    const cutoffTime = Date.now() - intervalMs;
    this.messageStore = this.messageStore.filter(msg => msg.timestamp >= cutoffTime);

    // Persist to storage
    await this.state.storage.put('messages', this.messageStore);
  }

  async scheduleNextSummary() {
    const summaryHour = parseInt(this.env.SUMMARY_TIME_HOUR) || 9;

    // Calculate next alarm time (next occurrence of the configured hour)
    const now = new Date();
    const next = new Date();
    next.setUTCHours(summaryHour, 0, 0, 0);

    if (next <= now) {
      next.setUTCDate(next.getUTCDate() + 1);
    }

    await this.state.storage.setAlarm(next);
    console.log(`Next summary scheduled for ${next.toISOString()}`);
  }

  async alarm() {
    console.log('Alarm triggered - sending summary');
    await this.sendSummary();

    // Schedule next alarm
    await this.scheduleNextSummary();
  }

  async sendSummary() {
    try {
      // Load messages from storage
      this.messageStore = (await this.state.storage.get('messages')) || [];

      const intervalHours = parseInt(this.env.SUMMARY_INTERVAL);
      const now = Date.now();
      const intervalMs = intervalHours * 60 * 60 * 1000;
      const cutoffTime = now - intervalMs;

      const recentMessages = this.messageStore.filter(msg => msg.timestamp >= cutoffTime);

      console.log(`Found ${recentMessages.length} messages to summarize`);

      if (recentMessages.length === 0) {
        console.log('No messages to summarize');
        return;
      }

      // Format summary
      const summary = this.formatSummary(recentMessages, intervalHours);

      // Create DM channel
      const dmChannelResponse = await fetch('https://discord.com/api/v10/users/@me/channels', {
        method: 'POST',
        headers: {
          Authorization: `Bot ${this.env.DISCORD_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          recipient_id: this.env.USER_ID,
        }),
      });

      const dmChannel = await dmChannelResponse.json();

      // Send summary
      await this.sendLongMessage(dmChannel.id, summary);

      console.log('Summary sent successfully');
    } catch (error) {
      console.error('Error sending summary:', error);
    }
  }

  formatSummary(messages, hours) {
    const header = `📊 **Message Summary** (Last ${hours} hours)\n`;
    const footer = `\n\n_Total: ${messages.length} message${messages.length !== 1 ? 's' : ''}_`;

    let body = '';

    for (const msg of messages) {
      const timestamp = new Date(msg.timestamp).toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
      });

      let content = msg.content;
      if (content.length > 100) {
        content = content.substring(0, 97) + '...';
      }

      if (!content.trim()) {
        content = '_[attachment or embed]_';
      }

      body += `• **${msg.author}** (${timestamp}): ${content}\n`;
    }

    return header + '\n' + body + footer;
  }

  async sendLongMessage(channelId, content) {
    const maxLength = 2000;

    if (content.length <= maxLength) {
      await this.sendDiscordMessage(channelId, content);
      return;
    }

    // Split into chunks
    const lines = content.split('\n');
    let currentChunk = '';

    for (const line of lines) {
      if ((currentChunk + line + '\n').length > maxLength) {
        if (currentChunk) {
          await this.sendDiscordMessage(channelId, currentChunk);
          currentChunk = '';
        }

        if (line.length > maxLength) {
          await this.sendDiscordMessage(channelId, line.substring(0, maxLength - 3) + '...');
        } else {
          currentChunk = line + '\n';
        }
      } else {
        currentChunk += line + '\n';
      }
    }

    if (currentChunk) {
      await this.sendDiscordMessage(channelId, currentChunk);
    }
  }

  async sendDiscordMessage(channelId, content) {
    await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bot ${this.env.DISCORD_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ content }),
    });
  }

  cleanup() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
    this.ws = null;
    this.isConnecting = false;
  }
}
