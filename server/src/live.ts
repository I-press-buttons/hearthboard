import type { FastifyInstance } from 'fastify';
import type { LiveMessage, LiveTopic } from '@hearthboard/shared';

interface Socket {
  readyState: number;
  send(data: string): void;
  on(event: 'close', cb: () => void): void;
}

/** Fan-out of change notifications to every open display and editor. */
export class LiveHub {
  private sockets = new Set<Socket>();
  private listeners = new Set<(msg: LiveMessage) => void>();

  publish(topic: LiveTopic, id?: string) {
    const msg: LiveMessage = id ? { topic, id } : { topic };
    const data = JSON.stringify(msg);
    for (const s of this.sockets) if (s.readyState === 1) s.send(data);
    for (const l of this.listeners) l(msg);
  }

  /** In-process subscription, used by tests. */
  subscribe(listener: (msg: LiveMessage) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  get size() {
    return this.sockets.size;
  }

  register(app: FastifyInstance) {
    app.get('/ws', { websocket: true }, (socket) => {
      const s = socket as unknown as Socket;
      this.sockets.add(s);
      s.on('close', () => this.sockets.delete(s));
    });
    // Keep idle connections alive through proxies.
    const ping = setInterval(() => {
      for (const s of this.sockets) if (s.readyState === 1) s.send('{"topic":"ping"}');
    }, 30_000);
    app.addHook('onClose', async () => clearInterval(ping));
  }
}
