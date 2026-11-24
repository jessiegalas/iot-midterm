import { isCommand } from './protocol.js';
import { allowedOrigin, beginEvents, createHttpService, readJson, replyJson, serveFrontend } from './http-responses.js';
import { serveLobby } from './lobby-http.js';
import { serveScores } from './score-http.js';
import { cleanName } from './lobbies.js';

const statuses = { invalid: 400, offline: 503, unavailable: 503, busy: 429, refused: 409, dropped: 409, uncertain: 409 };

export function consoleServer(bridge, { origin: fixedOrigin, dist = new URL('../dist/', import.meta.url),
  lobbies, scores, networks = () => [], joinPort = () => 5174, development = null,
  startHardware = (lobbyId, players, connection) => bridge.command('START', connection, { confirmStart: true, lobbyId, players }) } = {}) {
  return createHttpService(async (req, res) => {
    const reply = (status, body) => replyJson(res, status, body);
    const port = req.socket.localPort;
    const host = req.headers.host;
    if (fixedOrigin ? host !== new URL(fixedOrigin).host : host !== `localhost:${port}` && host !== `127.0.0.1:${port}`) {
      return reply(403, { code: 'host' });
    }
    const origin = fixedOrigin ?? `http://${host}`;

    if (req.method === 'GET' && req.url === '/api/events') {
      if (!allowedOrigin(req, origin)) return reply(403, { code: 'origin' });
      beginEvents(res, send => {
        bridge.on('change', send);
        send(bridge.view());
        return () => bridge.off('change', send);
      });
      return;
    }

    if (req.method === 'POST' && req.url === '/api/commands') {
      if (!allowedOrigin(req, origin)) return reply(403, { code: 'origin' });
      const payload = await readJson(req, res, 1024);
      if (!payload) return;
      const { command, connection } = payload;
      if (!isCommand(command) || typeof connection !== 'string' || !/^[a-f0-9]{16}$/.test(connection)) {
        return reply(400, { code: 'invalid' });
      }
      let outcome;
      if (command === 'START') {
        const defuser = cleanName(payload.players?.defuser);
        const expert = cleanName(payload.players?.expert);
        if (payload.players !== undefined && (!defuser || !expert)) return reply(400, { code: 'invalid' });
        outcome = await startHardware(null, { defuser: defuser || 'Defuser', expert: expert || 'Expert' }, connection);
      } else {
        outcome = await bridge.command(command, connection, { confirmReset: command === 'RESET' });
      }
      return reply(outcome.ok ? 200 : statuses[outcome.code] || 500, outcome);
    }

    if (req.url?.startsWith('/api/scores') && await serveScores(req, res, { scores, origin })) return;
    const phonePort = typeof joinPort === 'function' ? joinPort() : joinPort;
    if (lobbies && req.url?.startsWith('/api/lobbies') && await serveLobby(req, res, { lobbies, networks: networks(), joinPort: phonePort, origin, startHardware })) return;
    if (req.url?.startsWith('/api/')) return reply(404, { code: 'not-found' });
    if (development) {
      res.setHeader('Content-Security-Policy', `default-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self' ws://${host}; frame-ancestors 'none'; base-uri 'none'; form-action 'self'`);
      return development(req, res, () => reply(404, { code: 'not-found' }));
    }
    return serveFrontend(req, res, dist, req.url === '/');
  });
}
