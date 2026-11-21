const { EventEmitter } = require('node:events');

class EventBus extends EventEmitter {
  constructor() {
    super();
    this.clients = new Set();
  }

  /**
   * Registers a client for Server-Sent Events (SSE)
   */
  registerSseClient(req, res) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive'
    });

    res.write(`data: ${JSON.stringify({ type: 'CONNECTED', message: 'CertiFlow Live Stream Connected' })}\n\n`);

    const client = { id: Date.now(), res };
    this.clients.add(client);

    req.on('close', () => {
      this.clients.delete(client);
    });
  }

  /**
   * Broadcasts an event to all connected dashboard and verification clients
   */
  broadcast(eventType, payload) {
    const message = `data: ${JSON.stringify({
      type: eventType,
      data: payload,
      timestamp: new Date().toISOString()
    })}\n\n`;

    for (const client of this.clients) {
      try {
        client.res.write(message);
      } catch {
        this.clients.delete(client);
      }
    }

    this.emit(eventType, payload);
  }

  getActiveClientCount() {
    return this.clients.size;
  }
}

const eventBus = new EventBus();

module.exports = {
  eventBus
};
