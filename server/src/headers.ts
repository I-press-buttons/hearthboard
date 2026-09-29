import type { FastifyInstance } from 'fastify';

/** A Host header that can go into a CSP source as is. */
const HOST = /^(?:[a-z0-9.-]+|\[[0-9a-f:.]+\])(?::\d+)?$/i;

/**
 * Security headers on every response. The web app loads nothing from other sites: beyond
 * 'self' it only needs inline styles (FullCalendar and React style props) and data: images
 * (the two-step sign-in QR code). Other sites may not show it in a frame unless they are
 * listed in HEARTHBOARD_EMBED_ORIGINS, e.g. a Home Assistant dashboard.
 */
export function registerSecurityHeaders(app: FastifyInstance, embedOrigins: string[]) {
  const framing = embedOrigins.length ? embedOrigins.join(' ') : "'self'";
  app.addHook('onSend', async (req, reply) => {
    const host = req.headers.host ?? '';
    // Older WebKit (wall tablets) doesn't count ws: and wss: as 'self'.
    const ws = HOST.test(host) ? ` ws://${host} wss://${host}` : '';
    reply.header(
      'content-security-policy',
      [
        "default-src 'self'",
        "script-src 'self'",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: blob:",
        "font-src 'self' data:",
        `connect-src 'self'${ws}`,
        "object-src 'none'",
        "base-uri 'none'",
        "form-action 'self'",
        `frame-ancestors ${framing}`,
      ].join('; '),
    );
    // For browsers without frame-ancestors; it can't list other sites, so only when none are.
    if (!embedOrigins.length) reply.header('x-frame-options', 'SAMEORIGIN');
    reply.header('x-content-type-options', 'nosniff');
    reply.header('referrer-policy', 'same-origin');
  });
}
