import { readFile } from 'node:fs/promises';

const MIME = { html: 'text/html', js: 'text/javascript', css: 'text/css', woff2: 'font/woff2', woff: 'font/woff' };

export function securityHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.setHeader('Content-Security-Policy', "default-src 'self'; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
}

export function replyJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

export async function readJson(req, res, limit = 256) {
  if (req.headers['content-type'] !== 'application/json') {
    replyJson(res, 415, { code: 'invalid' });
    return null;
  }
  try {
    req.setEncoding('utf8');
    let body = '';
    for await (const chunk of req.iterator({ destroyOnReturn: false })) {
      body += chunk;
      if (body.length > limit) {
        res.setHeader('Connection', 'close');
        replyJson(res, 413, { code: 'invalid' });
        return null;
      }
    }
    const value = JSON.parse(body);
    if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  } catch {
    // Invalid JSON and interrupted request bodies share the same response.
  }
  replyJson(res, 400, { code: 'invalid' });
  return null;
}

export function beginEvents(res, subscribe) {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store' });
  const write = text => { if (!res.destroyed && !res.write(text)) res.destroy(); };
  const unsubscribe = subscribe(value => write(`data: ${JSON.stringify(value)}\n\n`));
  const keepalive = setInterval(() => write(': heartbeat\n\n'), 10000);
  res.on('close', () => {
    unsubscribe();
    clearInterval(keepalive);
  });
}

export async function serveFrontend(req, res, dist, indexPath) {
  const file = indexPath ? 'index.html' : req.url?.slice(1);
  if (req.method !== 'GET' || !/^(?:index\.html|assets\/[\w-]+\.(?:js|css|woff2?))$/.test(file)) {
    return replyJson(res, 404, { code: 'not-found' });
  }
  try {
    const contents = await readFile(new URL(file, dist));
    res.writeHead(200, { 'Content-Type': MIME[file.split('.').at(-1)],
      'Cache-Control': file === 'index.html' ? 'no-cache' : 'public, max-age=31536000, immutable' });
    res.end(contents);
  } catch {
    replyJson(res, 404, { code: 'build-missing' });
  }
}
