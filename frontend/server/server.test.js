import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { request } from 'node:http';
import test from 'node:test';
import tls from 'node:tls';
import { DeviceBridge } from './bridge.js';
import { consoleServer } from './http.js';
import { playerJoinServer } from './lobby-http.js';
import { PlayerLobbies } from './lobbies.js';
import { readLines } from './protocol.js';
import { tlsOptions, wifiServer } from './wifi.js';

async function listen(t, server) {
  const ready = once(server, 'listening');
  server.listen(0, '127.0.0.1');
  try {
    await ready;
  } catch (error) {
    if (error.code !== 'EACCES' && error.code !== 'EPERM') throw error;
    t.skip('This sandbox does not allow loopback listeners');
    return null;
  }
  t.after(() => {
    server.closeAllConnections?.();
    server.close();
  });
  return server.address().port;
}

test('HTTP serves board status and rejects forged, invalid, and offline commands', async t => {
  const bridge = new DeviceBridge();
  const origin = 'http://localhost:5173';
  const port = await listen(t, consoleServer(bridge, { origin }));
  if (port === null) return;
  const url = `http://127.0.0.1:${port}/api`;
  const headers = { Host: new URL(origin).host, 'Content-Type': 'application/json' };
  const send = (path, options, body) => new Promise((resolve, reject) => {
    const req = request(url + path, options, resolve);
    req.on('error', reject);
    req.end(body);
  });
  const submit = async (source, command) => {
    const response = await send('/commands', { method: 'POST', headers: { ...headers, Origin: source } },
      JSON.stringify({ command, connection: '0123456789abcdef' }));
    response.resume();
    return response.statusCode;
  };

  const events = await send('/events', { headers: { Host: headers.Host } });
  assert.match(events.headers['content-type'], /^text\/event-stream/);
  const [data] = await once(events, 'data');
  assert.equal(JSON.parse(data.toString().split('data: ')[1]).status, 'offline');
  events.destroy();
  assert.equal(await submit('http://untrusted.invalid', 'START'), 403);
  assert.equal(await submit(origin, 'KEY,invalid'), 400);
  assert.equal(await submit(origin, 'START'), 503);
});

test('the Wi-Fi listener rejects a wrong key and sends SYNC to the paired TLS client', async t => {
  const key = randomBytes(32);
  const identity = 'test-board';
  const bridge = new DeviceBridge();
  const port = await listen(t, wifiServer(bridge, { identity, key: key.toString('hex') }));
  if (port === null) return;
  const connect = psk => tls.connect({ ...tlsOptions, port, host: '127.0.0.1',
    checkServerIdentity: () => undefined, pskCallback: () => ({ identity, psk }) });

  const rejected = connect(randomBytes(32));
  await once(rejected, 'error');
  rejected.destroy();

  const paired = connect(key);
  t.after(() => paired.destroy());
  const received = new Promise(resolve => paired.on('data', readLines(resolve)));
  await once(paired, 'secureConnect');
  assert.equal(await received, 'SYNC');
  assert.equal(paired.getProtocol(), 'TLSv1.2');
});

test('phone joins update the host lobby and cannot reach host controls', async t => {
  const lobbies = new PlayerLobbies();
  const origin = 'http://localhost:5173';
  let phonePort;
  const phone = playerJoinServer(lobbies, { hosts: () => [`127.0.0.1:${phonePort}`] });
  phonePort = await listen(t, phone);
  if (phonePort === null) return;
  const hostPort = await listen(t, consoleServer(new DeviceBridge(), {
    origin, lobbies, joinPort: phonePort, networks: () => [{ name: 'Wi-Fi', address: '127.0.0.1' }],
  }));
  if (hostPort === null) return;

  const host = (path, method, body, requestOrigin = origin) => new Promise((resolve, reject) => {
    const req = request(`http://127.0.0.1:${hostPort}${path}`, { method,
      headers: { Host: new URL(origin).host, Origin: requestOrigin, 'Content-Type': 'application/json' } }, resolve);
    req.on('error', reject);
    req.end(body === undefined ? undefined : JSON.stringify(body));
  });
  const read = async res => {
    const chunks = [];
    for await (const chunk of res) chunks.push(chunk);
    return Buffer.concat(chunks);
  };
  const body = async res => JSON.parse((await read(res)).toString());

  const blocked = await host('/api/lobbies', 'POST', undefined, 'http://untrusted.invalid');
  assert.equal(blocked.statusCode, 403);
  blocked.resume();
  const created = await host('/api/lobbies', 'POST');
  assert.equal(created.statusCode, 201);
  const lobby = await body(created);
  const path = '/api/lobbies/' + lobby.id;
  const events = await host(path + '/events', 'GET');
  t.after(() => events.destroy());
  assert.match(events.headers['content-type'], /text\/event-stream/);
  const stream = events.iterator();
  const next = async () => JSON.parse((await stream.next()).value.toString().split('data: ')[1]);
  assert.deepEqual((await next()).players, { defuser: null, expert: null });

  const defuser = lobbies.invite(lobby.id, 'defuser');
  const expert = lobbies.invite(lobby.id, 'expert');
  assert.notEqual(defuser, expert);
  const qr = await host(path + '/qr/defuser?address=127.0.0.1', 'GET');
  assert.equal(qr.headers['content-type'], 'image/png');
  assert.equal((await read(qr)).subarray(1, 4).toString(), 'PNG');

  const localPhone = `http://127.0.0.1:${phonePort}`;
  const join = (invite, name, requestOrigin = localPhone) => fetch(localPhone + '/api/join/' + invite, {
    method: 'POST', headers: { Origin: requestOrigin, 'Content-Type': 'application/json' }, body: JSON.stringify({ name }),
  });
  assert.equal((await fetch(localPhone + '/api/commands')).status, 404);
  assert.equal((await fetch(localPhone + '/api/lobbies')).status, 404);
  const role = await (await fetch(localPhone + '/api/join/' + defuser)).json();
  assert.deepEqual(role, { role: 'defuser', occupied: false });
  assert.equal((await join(defuser, 'Rae', 'http://untrusted.invalid')).status, 403);
  assert.equal((await join(defuser, '  Rae  ')).status, 200);
  assert.deepEqual((await next()).players, { defuser: 'Rae', expert: null });
  assert.equal((await join(defuser, 'Other')).status, 409);
  assert.equal((await join(expert, '   ')).status, 400);

  const manual = await host(path + '/manual', 'POST', { expert: 'Sam' });
  assert.equal(manual.statusCode, 200);
  assert.deepEqual((await body(manual)).players, { defuser: 'Rae', expert: 'Sam' });
  const finalState = await next();
  assert.equal(finalState.revision, 2);
  assert.deepEqual(finalState.players, { defuser: 'Rae', expert: 'Sam' });
  assert.equal((await host(path, 'DELETE')).statusCode, 204);
  assert.equal(await next(), null);
  assert.equal((await join(expert, 'Sam')).status, 410);
});

test('expired invites cannot be used to take a slot', () => {
  let now = 0;
  const lobbies = new PlayerLobbies({ now: () => now });
  const lobby = lobbies.create();
  const invite = lobbies.invite(lobby.id, 'expert');
  now += 30 * 60 * 1000;
  assert.equal(lobbies.describe(invite), null);
  assert.deepEqual(lobbies.join(invite, 'Eli'), { code: 'closed' });
});
