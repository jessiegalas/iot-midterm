import { randomBytes } from 'node:crypto';
import QRCode from 'qrcode';
import { allowedOrigin, beginEvents, createHttpService, readJson, replyJson, serveFrontend } from './http-responses.js';

const TOKEN = '[a-f0-9]{36}';
const receiptPattern = new RegExp('^' + TOKEN + '$');
const hostRoute = new RegExp('^/api/lobbies(?:/(' + TOKEN + ')(?:/(events|manual|start|qr/(?:defuser|expert)|link/(?:defuser|expert)))?)?$');
const phoneRoute = new RegExp('^/(api/)?join/(' + TOKEN + ')$');
const lobbyErrors = { invalid: 400, incomplete: 409, occupied: 409, closed: 410, expired: 410, busy: 409,
  offline: 503, unavailable: 503, refused: 409, dropped: 409, uncertain: 409 };
const receiptCookie = 'defuse-player';

function playerReceipt(req) {
  const cookie = req.headers.cookie?.split(';').map(value => value.trim()).find(value => value.startsWith(receiptCookie + '='));
  const receipt = cookie?.slice(receiptCookie.length + 1);
  return receiptPattern.test(receipt ?? '') ? receipt : null;
}

function sendReceipt(res, invite, receipt) {
  res.setHeader('Set-Cookie', receiptCookie + '=' + receipt + '; Path=/api/join/' + invite +
    '; SameSite=Strict; HttpOnly; Max-Age=2400');
}

export async function serveLobby(req, res, { lobbies, networks, joinPort, origin, startHardware }) {
  const url = new URL(req.url, origin);
  const route = url.pathname.match(hostRoute);
  if (!route) return false;
  const [, id, action] = route;
  const reply = (status, body) => replyJson(res, status, body);
  const result = body => reply(lobbyErrors[body.code] ?? 200, body);
  const networkInfo = { networks, joinPort };
  if (!allowedOrigin(req, origin)) {
    reply(403, { code: 'origin' });
  } else if (req.method === 'POST' && !id) {
    const lobby = lobbies.create();
    if (lobby) reply(201, { ...lobby, ...networkInfo });
    else reply(429, { code: 'busy' });
  } else if (!id || !lobbies.view(id)) {
    reply(410, { code: lobbies.status(id) });
  } else if (req.method === 'GET' && !action) {
    reply(200, { ...lobbies.view(id), ...networkInfo });
  } else if (req.method === 'GET' && action === 'events') {
    beginEvents(res, send => {
      lobbies.on(id, send);
      send(lobbies.view(id));
      return () => lobbies.off(id, send);
    });
  } else if (req.method === 'GET' && /^(qr|link)\//.test(action ?? '')) {
    const address = url.searchParams.get('address');
    const [format, role] = action.split('/');
    const invite = lobbies.invite(id, role);
    if (!joinPort || !networks.some(network => network.address === address) || !invite) {
      reply(400, { code: 'invalid' });
      return true;
    }
    const joinUrl = 'http://' + address + ':' + joinPort + '/join/' + invite;
    if (format === 'link') {
      reply(200, { url: joinUrl });
    } else {
      try {
        const png = await QRCode.toBuffer(joinUrl, { width: 280, margin: 4, errorCorrectionLevel: 'M' });
        res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'no-store' });
        res.end(png);
      } catch {
        reply(500, { code: 'qr-failed' });
      }
    }
  } else if (req.method === 'POST' && action === 'manual') {
    const payload = await readJson(req, res);
    if (payload) result(lobbies.assign(id, payload));
  } else if (req.method === 'POST' && action === 'start') {
    const payload = await readJson(req, res, 256);
    if (!payload) return true;
    const { mode, connection } = payload;
    if (!['simulation', 'hardware'].includes(mode) || (mode === 'hardware' &&
      (typeof connection !== 'string' || !/^[a-f0-9]{16}$/.test(connection)))) {
      reply(400, { code: 'invalid' });
    } else {
      result(await lobbies.start(id, mode, players => startHardware(id, players, connection)));
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
  return createHttpService(async (req, res) => {
    const host = req.headers.host;
    if (!hosts().includes(host)) return replyJson(res, 403, { code: 'host' });
    const route = req.url?.match(phoneRoute);
    const [, api, invite] = route || [];
    if (api) {
      if (!allowedOrigin(req, 'http://' + host)) return replyJson(res, 403, { code: 'origin' });
      const receipt = playerReceipt(req);
      if (req.method === 'GET') {
        const state = lobbies.describe(invite, receipt);
        if (state && !state.occupied && !receipt) sendReceipt(res, invite, randomBytes(18).toString('hex'));
        return state ? replyJson(res, 200, state) : replyJson(res, 410, { code: 'closed' });
      }
      if (req.method === 'POST') {
        const payload = await readJson(req, res);
        if (payload) {
          const { receipt: confirmed, ...result } = lobbies.join(invite, payload.name, receipt);
          if (confirmed && receipt !== confirmed) sendReceipt(res, invite, confirmed);
          replyJson(res, lobbyErrors[result.code] ?? 200, result);
        }
        return;
      }
    }
    if ((route && !api) || req.url?.startsWith('/assets/')) return serveFrontend(req, res, dist, Boolean(route));
    return replyJson(res, 404, { code: 'not-found' });
  });
}
