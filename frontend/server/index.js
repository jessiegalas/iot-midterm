import { readFile } from 'node:fs/promises';
import { networkInterfaces } from 'node:os';
import { SerialPort } from 'serialport';
import { DeviceBridge } from './bridge.js';
import { consoleServer } from './http.js';
import { readLines } from './protocol.js';
import { wifiServer } from './wifi.js';
import { PlayerLobbies } from './lobbies.js';
import { playerJoinServer } from './lobby-http.js';

const configUrl = new URL('./bridge.local.json', import.meta.url);
const config = await readFile(configUrl, 'utf8').then(JSON.parse).catch(error => {
  if (error.code === 'ENOENT') return {};
  throw new Error('Read server/bridge.local.json as JSON failed.');
});
const usbPath = config.serialPort;
if (usbPath && !/^COM[1-9]\d*$/i.test(usbPath)) throw new Error('Set serialPort to a Windows COM port.');
const wifi = config.wifi;
if (wifi && (!/^[A-Za-z0-9_-]{1,32}$/.test(wifi.identity ?? '') || !/^[a-fA-F0-9]{64}$/.test(wifi.key ?? ''))) {
  throw new Error('Set the Wi-Fi identity and a 32-byte hex pairing key in bridge.local.json.');
}

const bridge = new DeviceBridge();
const lobbies = new PlayerLobbies();
const joinPort = 5174;

function localNetworks() {
  return Object.entries(networkInterfaces())
    .flatMap(([name, entries]) => entries.filter(entry => !entry.internal && entry.family === 'IPv4')
      .map(({ address }) => ({ name, address })))
    .sort((a, b) => Number(/wi-?fi|wireless|wlan/i.test(b.name)) - Number(/wi-?fi|wireless|wlan/i.test(a.name)));
}

function openUsb() {
  if (!usbPath) return;
  const port = new SerialPort({ path: usbPath, baudRate: 115200, autoOpen: false, hupcl: false });
  port.open(error => {
    if (error) {
      setTimeout(openUsb, 3000);
      return;
    }
    // Keep the session open in standby to avoid toggling reset lines at handoff time.
    port.set({ dtr: false, rts: false }, () => {});
    const link = bridge.attach('usb', line => port.write(`${line}\n`, error => {
      if (error && port.isOpen) port.close();
    }));
    port.on('data', readLines(link.line));
    port.on('error', () => { if (port.isOpen) port.close(); });
    port.once('close', () => {
      link.close();
      setTimeout(openUsb, 3000);
    });
  });
}
openUsb();

if (wifi) {
  const server = wifiServer(bridge, wifi);
  server.on('error', error => console.error(`Wi-Fi listener unavailable (${error.code ?? 'unknown error'}). USB remains available.`));
  server.listen(8443, wifi.bind ?? '0.0.0.0');
}

setInterval(() => bridge.tick(), 100);
const phones = playerJoinServer(lobbies, { hosts: () => localNetworks().map(({ address }) => `${address}:${joinPort}`) });
phones.on('error', error => console.error(`Phone join listener unavailable (${error.code ?? 'unknown error'}). Manual entry remains available.`));
phones.listen(joinPort, '0.0.0.0');
consoleServer(bridge, { lobbies, joinPort, networks: () => phones.listening ? localNetworks() : [] })
  .listen(5173, '127.0.0.1', () => console.log('Open http://localhost:5173'));
