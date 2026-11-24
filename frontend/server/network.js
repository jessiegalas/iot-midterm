import { networkInterfaces } from 'node:os';

export function portOptions(value, name, preferred, fallbackStart) {
  if (value === undefined) return [preferred, ...Array.from({ length: 10 }, (_, index) => fallbackStart + index)];
  if (!/^\d{1,5}$/.test(value) || Number(value) < 1 || Number(value) > 65535) {
    throw new Error(`${name} must be a TCP port from 1 to 65535.`);
  }
  return [Number(value)];
}

export async function listenOn(server, host, ports) {
  if (!ports.length) throw new Error('No TCP ports are available in the configured range.');
  let failure;
  for (const port of ports) {
    try {
      return await new Promise((resolve, reject) => {
        const onError = error => {
          server.off('listening', onListening);
          reject(error);
        };
        const onListening = () => {
          server.off('error', onError);
          resolve(server.address().port);
        };
        server.once('error', onError).once('listening', onListening).listen(port, host);
      });
    } catch (error) {
      if (!['EADDRINUSE', 'EACCES'].includes(error.code)) throw error;
      failure = error;
    }
  }
  throw failure;
}

export function lanNetworks(interfaces = networkInterfaces()) {
  const wifi = /wi-?fi|wireless|wlan/i;
  const virtual = /virtual|vethernet|hyper-v|loopback|vpn|wsl|docker|tailscale|vmware|virtualbox|bluetooth|tunnel|tap-|hamachi/i;
  const candidates = Object.entries(interfaces).flatMap(([name, entries]) =>
    (entries ?? []).filter(({ internal, family, address }) => !internal && family === 'IPv4' &&
      !/^(?:0\.|127\.|169\.254\.)/.test(address) && Number(address.split('.')[0]) < 224)
      .map(({ address }) => ({ name, address, preferred: !virtual.test(name) })));
  return candidates.sort((a, b) => Number(b.preferred) - Number(a.preferred) || Number(wifi.test(b.name)) - Number(wifi.test(a.name)))
    .filter((candidate, index, sorted) => sorted.findIndex(({ address }) => address === candidate.address) === index);
}
