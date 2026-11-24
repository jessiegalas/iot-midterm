import { createServer } from 'node:http';
import { isCommand } from './protocol.js';
import { beginEvents, readJson, replyJson, securityHeaders, serveFrontend } from './http-responses.js';
import { serveLobby } from './lobby-http.js';

const statuses = { invalid: 400, offline: 503, busy: 429, refused: 409, dropped: 409, uncertain: 409 };

export function consoleServer(bridge, { origin = 'http://localhost:5173', dist = new URL('../dist/', import.meta.url),
  lobbies, networks = () => [], joinPort = 5174 } = {}) {
  const host = new URL(origin).host;
  return createServer({ requestTimeout: 10000 }, async (req, res) => {
    securityHeaders(res);
    const reply = (status, body) => replyJson(res, status, body);
    if (req.headers.host !== host) return reply(403, { code: 'host' });

    if (req.method === 'GET' && req.url === '/api/events') {
      if (req.headers.origin && req.headers.origin !== origin) return reply(403, { code: 'origin' });
      beginEvents(res, send => {
        bridge.on('change', send);
        send(bridge.view());
        return () => bridge.off('change', send);
      });
      return;
    }

    if (req.method === 'POST' && req.url === '/api/commands') {
      if (req.headers.origin !== origin) return reply(403, { code: 'origin' });
      const payload = await readJson(req, res, 128);
      if (!payload) return;
      const { command, connection } = payload;
      if (!isCommand(command) || typeof connection !== 'string' || !/^[a-f0-9]{16}$/.test(connection)) {
        return reply(400, { code: 'invalid' });
      }
      const outcome = await bridge.command(command, connection);
      return reply(outcome.ok ? 200 : statuses[outcome.code] || 500, outcome);
    }

    if (lobbies && req.url?.startsWith('/api/lobbies') && await serveLobby(req, res, { lobbies, networks: networks(), joinPort, origin })) return;
    return serveFrontend(req, res, dist, req.url === '/');
  });
}
