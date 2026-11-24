import tls from 'node:tls';
import { readLines } from './protocol.js';

export const tlsOptions = {
  minVersion: 'TLSv1.2',
  maxVersion: 'TLSv1.2',
  ciphers: 'PSK-AES128-GCM-SHA256',
};

export function wifiServer(bridge, { key, identity }) {
  const secret = Buffer.from(key, 'hex');
  let pairedSocket;
  return tls.createServer({
    ...tlsOptions,
    pskCallback: (_socket, candidate) => candidate === identity ? secret : null,
    handshakeTimeout: 3000,
  }, socket => {
    pairedSocket?.destroy();
    pairedSocket = socket;
    socket.setNoDelay(true);
    socket.setTimeout(4500, () => socket.destroy());
    const link = bridge.attach('wifi', line => {
      if (!socket.write(`${line}\n`)) socket.destroy();
    });
    socket.on('data', readLines(link.line));
    socket.on('error', () => socket.destroy());
    socket.once('close', () => {
      if (pairedSocket === socket) pairedSocket = null;
      link.close();
    });
  });
}
