import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import test from 'node:test';
import { lanNetworks, listenOn, portOptions } from './network.js';

const listen = server => listenOn(server, '127.0.0.1', [0]);
const close = server => new Promise(resolve => server.close(resolve));

test('startup tries the preferred port first, then falls back from occupied ports', async () => {
  const occupied = createServer();
  const port = await listen(occupied);
  const fallback = createServer();
  try {
    assert.notEqual(await listenOn(fallback, '127.0.0.1', [port, 0]), port);
  } finally {
    await close(fallback);
    await close(occupied);
  }

  const preferred = createServer();
  try { assert.equal(await listenOn(preferred, '127.0.0.1', [port, 0]), port); }
  finally { await close(preferred); }
});

test('startup validates overrides and orders usable LAN adapters before virtual adapters', () => {
  const ipv4 = address => ({ address, family: 'IPv4', internal: false });
  assert.deepEqual(portOptions('5309', 'DEFUSE_CONSOLE_PORT', 5173, 5175), [5309]);
  assert.throws(() => portOptions('65536', 'DEFUSE_JOIN_PORT', 5174, 5185), /TCP port/);
  assert.equal(portOptions(undefined, 'DEFUSE_JOIN_PORT', 5174, 5185)[0], 5174);
  assert.deepEqual(lanNetworks({
    Ethernet: [ipv4('169.254.1.2'), ipv4('192.168.1.4')],
    VPN: [ipv4('10.0.0.2')],
    'Wi-Fi': [ipv4('192.168.1.9')],
    Loopback: [{ ...ipv4('127.0.0.1'), internal: true }],
  }).map(({ name, address, preferred }) => [name, address, preferred]), [
    ['Wi-Fi', '192.168.1.9', true], ['Ethernet', '192.168.1.4', true], ['VPN', '10.0.0.2', false],
  ]);
});
