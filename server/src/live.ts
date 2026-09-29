import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { LiveMessage, LiveTopic } from '@hearthboard/shared';

interface Socket {
  readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  on(event: 'close', cb: () => void): void;
}

/** Why a socket was let in, so it can be closed when that stops being true. */
export interface SocketAccess {
  /** The paired screen it belongs to. */
  displayId: string | null;
  signedIn: boolean;
}

/** WebSocket close code for "you're not allowed here any more". */
export const CLOSE_POLICY = 1008;

/** Fan-out of change notifications to every open display and editor. */
export class LiveHub {
  private sockets = new Map<Socket, SocketAccess>();
  private listeners = new Set<(msg: LiveMessage) => void>();

  publish(topic: LiveTopic, id?: string) {
    const msg: LiveMessage = id ? { topic, id } : { topic };
    const data = JSON.stringify(msg);
    for (const s of this.sockets.keys()) if (s.readyState === 1) s.send(data);
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

  /** Close the sockets `match` picks out, e.g. a screen that was just unpaired. */
  disconnect(match: (access: SocketAccess) => boolean) {
    for (const [s, access] of this.sockets) {
      if (match(access)) s.close(CLOSE_POLICY, 'Pair this screen first.');
    }
  }

  /** `guard` runs during the upgrade, so a refused screen never gets a socket. */
  register(
    app: FastifyInstance,
    guard: (req: FastifyRequest, reply: FastifyReply) => Promise<unknown>,
  ) {
    app.get('/ws', { websocket: true, preValidation: guard }, (socket, req) => {
      const s = socket as unknown as Socket;
      this.sockets.set(s, { displayId: req.display?.id ?? null, signedIn: !!req.user });
      s.on('close', () => this.sockets.delete(s));
    });
    // Keep idle connections alive through proxies.
    const ping = setInterval(() => {
      for (const s of this.sockets.keys()) if (s.readyState === 1) s.send('{"topic":"ping"}');
    }, 30_000);
    app.addHook('onClose', async () => clearInterval(ping));
  }
}
