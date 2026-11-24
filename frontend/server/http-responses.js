import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';

const MIME = { html: 'text/html', js: 'text/javascript', css: 'text/css', woff2: 'font/woff2', woff: 'font/woff', ogg: 'audio/ogg' };

function securityHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.setHeader('Content-Security-Policy', "default-src 'self'; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
}

export function createHttpService(handle) {
  return createServer({ requestTimeout: 10000, headersTimeout: 10000 }, (req, res) => {
    securityHeaders(res);
    Promise.resolve().then(() => handle(req, res)).catch(() => {
      if (res.destroyed || res.writableEnded) return;
      if (res.headersSent) res.destroy();
      else replyJson(res, 500, { code: 'unavailable' });
    });
  });
}

export function allowedOrigin(req, origin) {
  return req.headers.origin === origin || (req.method === 'GET' && req.headers.origin === undefined);
}

export function replyJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

export async function readJson(req, res, limit = 256) {
  if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(req.headers['content-type'] ?? '')) {
    replyJson(res, 415, { code: 'invalid' });
    return null;
  }
  const oversized = () => {
    res.setHeader('Connection', 'close');
    replyJson(res, 413, { code: 'invalid' });
    return null;
  };
  if (Number(req.headers['content-length']) > limit) return oversized();
  try {
    const chunks = [];
    let bytes = 0;
    for await (const chunk of req.iterator({ destroyOnReturn: false })) {
      bytes += chunk.length;
      if (bytes > limit) return oversized();
      chunks.push(chunk);
    }
    const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks, bytes)));
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
  if (req.method !== 'GET' || !/^(?:index\.html|assets\/[\w-]+\.(?:js|css|woff2?|ogg))$/.test(file)) {
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
