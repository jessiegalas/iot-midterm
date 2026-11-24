import { allowedOrigin, readJson, replyJson } from './http-responses.js';

export async function serveScores(req, res, { scores, origin }) {
  if (!['/api/scores', '/api/scores/import'].includes(req.url)) return false;
  const reply = (status, body) => replyJson(res, status, body);
  if (!allowedOrigin(req, origin)) {
    reply(403, { code: 'origin' });
    return true;
  }
  try {
    if (!scores) {
      reply(503, { code: 'storage-unavailable' });
    } else if (req.method === 'GET' && req.url === '/api/scores') {
      reply(200, { scores: scores.list() });
    } else if (req.method === 'POST' && req.url === '/api/scores') {
      const payload = await readJson(req, res, 2048);
      if (payload) {
        const code = scores.saveSimulation(payload);
        if (code === 'invalid' || code === 'conflict') reply(code === 'conflict' ? 409 : 400, { code });
        else reply(code === 'saved' ? 201 : 200, { code, id: payload.id });
      }
    } else if (req.method === 'POST' && req.url === '/api/scores/import') {
      const payload = await readJson(req, res, 256 * 1024);
      if (payload) {
        if (!Array.isArray(payload.scores) || payload.scores.length > 1000) reply(400, { code: 'invalid' });
        else reply(200, scores.importLegacy(payload.scores));
      }
    } else {
      reply(404, { code: 'not-found' });
    }
  } catch {
    reply(503, { code: 'storage-unavailable' });
  }
  return true;
}
