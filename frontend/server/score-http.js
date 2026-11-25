import { allowedOrigin, readJson, replyJson } from './http-responses.js';

export async function serveRuns(req, res, { scores, origin }) {
  const url = new URL(req.url, origin);
  const detail = url.pathname.match(/^\/api\/runs\/([a-z0-9_:%-]{1,128})(\/hints)?$/i);
  if (url.pathname !== '/api/runs' && !detail) return false;
  const reply = (status, body) => replyJson(res, status, body);
  if (!allowedOrigin(req, origin)) {
    reply(403, { code: 'origin' });
    return true;
  }
  const now = Date.now();
  try {
    if (!scores) {
      reply(503, { code: 'storage-unavailable' });
    } else if (detail) {
      let id;
      try { id = decodeURIComponent(detail[1]); } catch { id = ''; }
      if (!/^[a-z0-9:_-]{1,128}$/i.test(id)) {
        reply(400, { code: 'invalid' });
      } else if (detail[2] && req.method === 'POST') {
        const body = await readJson(req, res, 512);
        if (body) {
          const hints = scores.transaction(() => scores.history.unlockHint(id, body, now));
          reply(hints ? 200 : 409, hints ? { hints } : { code: 'unavailable' });
        }
      } else if (detail[2] && req.method === 'GET') {
        reply(200, { hints: scores.history.listHints(id) });
      } else if (req.method === 'GET') {
        const run = scores.history.get(id, now);
        reply(run ? 200 : 404, run ? { run } : { code: 'not-found' });
      } else {
        reply(404, { code: 'not-found' });
      }
    } else if (req.method === 'GET') {
      const page = Number(url.searchParams.get('page') || 1);
      if (!Number.isSafeInteger(page) || page < 1) reply(400, { code: 'invalid' });
      else reply(200, scores.history.list(page, now));
    } else if (req.method === 'POST') {
      const body = await readJson(req, res, 2048);
      if (body) {
        const code = scores.transaction(() => scores.history.saveSimulation(body, now));
        const statuses = { saved: 201, duplicate: 200, invalid: 400, conflict: 409 };
        reply(statuses[code], { code });
      }
    } else {
      reply(404, { code: 'not-found' });
    }
  } catch {
    reply(503, { code: 'storage-unavailable' });
  }
  return true;
}

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
