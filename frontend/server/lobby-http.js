import { createServer } from 'node:http';
import QRCode from 'qrcode';
import { beginEvents, readJson, replyJson, securityHeaders, serveFrontend } from './http-responses.js';

const TOKEN = '[a-f0-9]{36}';
const hostRoute = new RegExp(`^/api/lobbies(?:/(${TOKEN})(?:/(events|manual|qr/(?:defuser|expert)))?)?$`);
const phoneRoute = new RegExp(`^/(api/)?join/(${TOKEN})$`);
const lobbyErrors = { invalid: 400, occupied: 409, closed: 410 };

export async function serveLobby(req, res, { lobbies, networks, joinPort, origin }) {
  const url = new URL(req.url, origin);
  const route = url.pathname.match(hostRoute);
  if (!route) return false;
  const [, id, action] = route;
  const reply = (status, body) => replyJson(res, status, body);
  if (req.headers.origin && req.headers.origin !== origin || req.method !== 'GET' && req.headers.origin !== origin) {
    reply(403, { code: 'origin' });
  } else if (req.method === 'POST' && !id) {
    const lobby = lobbies.create();
    if (lobby) reply(201, { ...lobby, networks });
    else reply(429, { code: 'busy' });
  } else if (!id || !lobbies.view(id)) {
    reply(410, { code: 'closed' });
  } else if (req.method === 'GET' && action === 'events') {
    beginEvents(res, send => {
      lobbies.on(id, send);
      send(lobbies.view(id));
      return () => lobbies.off(id, send);
    });
  } else if (req.method === 'GET' && action?.startsWith('qr/')) {
    const address = url.searchParams.get('address');
    if (!networks.some(network => network.address === address)) {
      reply(400, { code: 'invalid' });
      return true;
    }
    const invite = lobbies.invite(id, action.split('/')[1]);
    try {
      const png = await QRCode.toBuffer(`http://${address}:${joinPort}/join/${invite}`, { width: 280, margin: 4, errorCorrectionLevel: 'M' });
      res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'no-store' });
      res.end(png);
    } catch {
      reply(500, { code: 'qr-failed' });
    }
  } else if (req.method === 'POST' && action === 'manual') {
    const payload = await readJson(req, res);
    if (payload) {
      const result = lobbies.assign(id, payload);
      reply(lobbyErrors[result.code] ?? 200, result);
    }
  } else if (req.method === 'DELETE' && !action) {
    lobbies.close(id);
    res.writeHead(204).end();
  } else {
    reply(404, { code: 'not-found' });
  }
  return true;
}

export function playerJoinServer(lobbies, { hosts, dist = new URL('../dist/', import.meta.url) }) {
  return createServer({ requestTimeout: 10000 }, async (req, res) => {
    securityHeaders(res);
    const host = req.headers.host;
    if (!hosts().includes(host)) return replyJson(res, 403, { code: 'host' });
    const route = req.url?.match(phoneRoute);
    const [, api, invite] = route || [];
    if (api) {
      if (req.headers.origin && req.headers.origin !== `http://${host}`) return replyJson(res, 403, { code: 'origin' });
      if (req.method === 'GET') {
        const state = lobbies.describe(invite);
        return state ? replyJson(res, 200, state) : replyJson(res, 410, { code: 'closed' });
      }
      if (req.method === 'POST') {
        if (req.headers.origin !== `http://${host}`) return replyJson(res, 403, { code: 'origin' });
        const payload = await readJson(req, res);
        if (payload) {
          const result = lobbies.join(invite, payload.name);
          replyJson(res, lobbyErrors[result.code] ?? 200, result);
        }
        return;
      }
    }
    if ((route && !api) || req.url?.startsWith('/assets/')) return serveFrontend(req, res, dist, Boolean(route));
    return replyJson(res, 404, { code: 'not-found' });
  });
}
