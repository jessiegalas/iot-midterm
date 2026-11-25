import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { SerialPort } from 'serialport';
import { DeviceBridge } from './bridge.js';
import { consoleServer } from './http.js';
import { readLines } from './protocol.js';
import { wifiServer } from './wifi.js';
import { PlayerLobbies } from './lobbies.js';
import { playerJoinServer } from './lobby-http.js';
import { lanNetworks, listenOn, portOptions } from './network.js';
import { ScoreStore } from './storage.js';
import { HardwareState } from './hardware-state.js';

const dev = process.argv.includes('--dev');
const frontend = fileURLToPath(new URL('../', import.meta.url));
const hostPorts = portOptions(process.env.DEFUSE_CONSOLE_PORT, 'DEFUSE_CONSOLE_PORT', 5173, 5175);
const phonePorts = portOptions(process.env.DEFUSE_JOIN_PORT, 'DEFUSE_JOIN_PORT', 5174, 5185);
if (hostPorts.length === 1 && phonePorts.length === 1 && hostPorts[0] === phonePorts[0]) {
  throw new Error('The console and phone listener need different ports.');
}

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

const lobbies = new PlayerLobbies();
let scores;
let recorder;
try {
  scores = new ScoreStore();
  recorder = new HardwareState(scores, {
    onStarted: (lobby, run) => lobbies.confirm(lobby, run),
    onAbandoned: lobby => lobbies.release(lobby),
  });
} catch (error) {
  console.error('SQLite could not open the score database. Simulation remains available; scores and named hardware starts need SQLite. (' +
    (error.code ?? 'database setup failed') + ')');
}
const bridge = new DeviceBridge({ recorder, requireStorage: true });
let vite;
let stopping = false;
let starting = true;
let shutdown;
let usb;
let usbRetry;
let heartbeat;
let lobbySweep;
let paired;
let phones;
let phoneBuild;
let joinPort = null;
const wifiSockets = new Set();
const consoleHttp = consoleServer(bridge, { lobbies, scores, joinPort: () => phones?.listening ? joinPort : null,
  networks: () => phones?.listening ? lanNetworks() : [],
  development: dev ? (req, res, next) => vite.middlewares(req, res, next) : null,
});

function stop() {
  stopping = true;
  if (starting) return;
  shutdown ??= closeServices();
  return shutdown;
}

async function closeServices() {
  clearTimeout(usbRetry);
  clearInterval(heartbeat);
  clearInterval(lobbySweep);
  const serialClosing = new Promise(resolve => {
    if (usb?.isOpen) usb.close(() => resolve());
    else resolve();
  });
  for (const socket of wifiSockets) socket.destroy();
  const servers = [consoleHttp, phones, paired].filter(server => server?.listening);
  const closing = servers.map(server => new Promise(resolve => {
    server.close(resolve);
    server.closeAllConnections?.();
  }));
  await Promise.allSettled([...closing, vite?.close(), serialClosing]);
  scores?.close();
  if (phoneBuild && dirname(resolve(phoneBuild)) === resolve(tmpdir()) && basename(phoneBuild).startsWith('defuse-phone-')) {
    await rm(phoneBuild, { recursive: true, force: true, maxRetries: 3 }).catch(error => {
      console.warn('The temporary phone bundle could not be removed (' + error.code + ').');
    });
  }
}

process.once('SIGINT', stop);
process.once('SIGTERM', stop);

function checkStartup() {
  if (stopping) throw new Error('Startup cancelled');
}

function openUsb() {
  if (!usbPath || stopping) return;
  const port = new SerialPort({ path: usbPath, baudRate: 115200, autoOpen: false, hupcl: false });
  usb = port;
  port.open(error => {
    if (stopping) {
      if (port.isOpen) port.close();
      return;
    }
    if (error) {
      usbRetry = setTimeout(openUsb, 3000);
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
      if (!stopping) usbRetry = setTimeout(openUsb, 3000);
    });
  });
}
try {
  if (dev) {
    const { build, createServer } = await import('vite');
    phoneBuild = await mkdtemp(join(tmpdir(), 'defuse-phone-'));
    await build({ root: frontend, build: { outDir: phoneBuild, emptyOutDir: false } });
    checkStartup();
    vite = await createServer({
      root: frontend,
      server: {
        middlewareMode: true,
        cors: false,
        hmr: { server: consoleHttp },
        fs: { allow: [frontend, fileURLToPath(new URL('../../music/songs/', import.meta.url))] },
      },
    });
  } else {
    await access(new URL('../dist/index.html', import.meta.url)).catch(() => {
      throw new Error('Frontend build missing. Run npm run build before npm start.');
    });
  }

  checkStartup();
  phones = playerJoinServer(lobbies, {
    hosts: () => lanNetworks().map(({ address }) => `${address}:${joinPort}`),
    dist: phoneBuild ? pathToFileURL(phoneBuild + sep) : undefined,
  });
  const consolePort = await listenOn(consoleHttp, '127.0.0.1', hostPorts.filter(port => phonePorts.length !== 1 || port !== phonePorts[0]));
  try {
    joinPort = await listenOn(phones, '0.0.0.0', phonePorts.filter(port => port !== consolePort));
  } catch (error) {
    console.error(`Phone join listener unavailable (${error.code ?? 'unknown error'}). Manual entry remains available.`);
  }
  consoleHttp.on('error', error => {
    console.error(`Console listener failed (${error.code ?? 'unknown error'}).`);
    process.exitCode = 1;
    void stop();
  });
  phones.on('error', error => console.error(`Phone join listener failed (${error.code ?? 'unknown error'}).`));

  if (wifi) {
    paired = wifiServer(bridge, wifi);
    paired.on('connection', socket => {
      wifiSockets.add(socket);
      socket.once('close', () => wifiSockets.delete(socket));
    });
    try {
      await listenOn(paired, wifi.bind ?? '0.0.0.0', [8443]);
    } catch (error) {
      console.error(`Wi-Fi listener unavailable (${error.code ?? 'unknown error'}). USB remains available.`);
    }
    paired.on('error', error => console.error(`Wi-Fi listener failed (${error.code ?? 'unknown error'}).`));
  }
  checkStartup();
  openUsb();
  heartbeat = setInterval(() => bridge.tick(), 100);
  lobbySweep = setInterval(() => lobbies.sweep(), 10000);
  console.log(`Console ready at http://localhost:${consolePort}`);
  if (joinPort) {
    const networks = lanNetworks();
    for (const { name, address } of networks) console.log(`Phone joining at http://${address}:${joinPort} (${name})`);
    if (!networks[0]?.preferred) console.warn('No preferred LAN address found. Check the network selector or use manual entry.');
    else console.log(`Default phone network: ${networks[0].name} (${networks[0].address})`);
  }
} catch (error) {
  if (!stopping) {
    console.error(`Decidefer startup failed: ${error.message}`);
    process.exitCode = 1;
  }
  stopping = true;
} finally {
  starting = false;
  if (stopping) await stop();
}
