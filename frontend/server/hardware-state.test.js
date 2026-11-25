import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { DeviceBridge } from './bridge.js';
import { HardwareState } from './hardware-state.js';
import { PlayerLobbies } from './lobbies.js';
import { ScoreStore } from './storage.js';

const device = '123456abcdef';
const firstBoot = 'abcd1234';
const players = { defuser: 'Kai', expert: 'Ali' };
const identity = 'esp32:' + device + ':' + firstBoot + ':1';

function state(revision, { phase = 'idle', boot = firstBoot, run = 0, command = '', seconds = 240, entry = '' } = {}) {
  const inProgress = phase === 'playing' || phase === 'won' || phase === 'lost';
  return ['@STATE', boot, run, revision, phase, phase === 'won' ? 3 : 1, seconds, entry, 0, 0,
    phase === 'won' ? 1 : 0, 0, inProgress ? '-----:.----:..---:...--' : '', phase === 'won' ? '1:13' : inProgress ? '2' : '',
    phase === 'lost' ? 'WIRE' : '', command, phase === 'won' ? 8 : 0,
    phase === 'won' ? 8 : Number(phase === 'lost'), seconds * 1000].join(',');
}

function fixture(store, lobbies = new PlayerLobbies()) {
  let now = 0;
  const recorder = new HardwareState(store, {
    date: () => 10000 + now,
    onStarted: (id, run) => lobbies.confirm(id, run),
    onAbandoned: id => lobbies.release(id),
  });
  const bridge = new DeviceBridge({ now: () => now, recorder, requireStorage: true });
  function connect(kind, boot = firstBoot) {
    const commands = [];
    const link = bridge.attach(kind, line => commands.push(line));
    link.line('@HELLO,3,' + device + ',' + boot);
    return { ...link, commands, take(snapshot) {
      const request = commands.findLast(line => line.startsWith('TAKE,'));
      assert.ok(request, 'A paired board waits for TAKE');
      const lease = request.split(',')[1];
      link.line('@TAKEN,' + lease);
      link.line(snapshot);
      return lease;
    } };
  }
  return { bridge, connect, lobbies, advance(ms) { now += ms; bridge.tick(); } };
}

function start(f, link, lease) {
  const { id } = f.lobbies.create();
  f.lobbies.assign(id, players);
  const outcome = f.lobbies.start(id, 'hardware', names => f.bridge.command('START', lease, {
    confirmStart: true, lobbyId: id, players: names,
  }));
  return Promise.resolve().then(() => {
    const sent = link.commands.findLast(line => line.endsWith(',START'));
    assert.ok(sent, 'Bridge issued START');
    return { outcome, command: sent.split(',')[2], lobby: id };
  });
}

test('start roster is written before START and survives bridge and database reopen', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'defuse-hardware-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const file = join(directory, 'defuse.sqlite');
  let store = new ScoreStore(file);
  const first = fixture(store);
  const cable = first.connect('usb');
  const lease = cable.take(state(10));
  const { outcome, command } = await start(first, cable, lease);
  assert.deepEqual({ ...store.db.prepare('SELECT defuser, expert, status FROM pending_hardware_starts WHERE command = ?').get(command) },
    { ...players, status: 'pending' });
  cable.line('@ACK,' + lease + ',' + command + ',OK');
  assert.equal(first.bridge.view().state.phase, 'idle');
  assert.equal(store.db.prepare('SELECT count(*) AS n FROM hardware_rosters').get().n, 0);
  cable.line(state(11, { phase: 'ready', run: 1, command: 'aaaaaaaaaaaaaaaa' }));
  assert.equal(store.db.prepare('SELECT count(*) AS n FROM hardware_rosters').get().n, 0);
  cable.line(state(12, { phase: 'playing', run: 1, command, entry: '01', seconds: 220 }));
  assert.equal((await outcome).runId, identity);
  assert.equal(first.bridge.view().state.players.team, 'Kai + Ali');
  store.close();

  store = new ScoreStore(file);
  try {
    const reopened = fixture(store);
    assert.equal(reopened.bridge.view().runStatus, 'reconnecting');
    assert.equal(reopened.bridge.view().state.players.team, 'Kai + Ali');
    const wifi = reopened.connect('wifi');
    wifi.take(state(13, { phase: 'playing', run: 1, command, entry: '012', seconds: 217 }));
    assert.equal(reopened.bridge.view().state.entry, '012');
    assert.equal(reopened.bridge.view().state.players.team, 'Kai + Ali');
    const result = state(14, { phase: 'won', run: 1, command, seconds: 104 });
    wifi.line(result);
    wifi.line(result);
    assert.equal(reopened.bridge.view().scoreStatus, 'saved');
    assert.deepEqual(store.list().map(row => [row.id, row.team]), [[identity, 'Kai + Ali']]);
    assert.equal(store.db.prepare('SELECT status FROM hardware_runs WHERE id = ?').get(identity).status, 'won');
    assert.equal(wifi.commands.some(line => line.endsWith(',START')), false);
  } finally { store.close(); }
});

test('Wi-Fi loss confirms an in-flight start on USB exactly once and preserves the roster', async () => {
  const store = new ScoreStore(':memory:');
  try {
    const f = fixture(store);
    const wifi = f.connect('wifi');
    const usb = f.connect('usb');
    const lease = wifi.take(state(1));
    const { outcome, command, lobby } = await start(f, wifi, lease);
    wifi.close();
    usb.take(state(2, { phase: 'ready', run: 1, command }));
    assert.equal((await outcome).ok, true);
    assert.equal(f.lobbies.view(lobby).status, 'started');
    assert.equal(f.bridge.view().transport, 'usb');
    const result = state(3, { phase: 'won', run: 1, command, seconds: 100 });
    usb.line(result);
    usb.line(result);
    assert.equal(store.list().length, 1);
    assert.equal(store.list()[0].team, 'Kai + Ali');
    assert.equal(usb.commands.some(line => line.endsWith(',START')), false);
  } finally { store.close(); }
});

test('an interrupted start is released only after reconciliation proves the board did not start', async () => {
  const store = new ScoreStore(':memory:');
  try {
    const f = fixture(store);
    const wifi = f.connect('wifi');
    const usb = f.connect('usb');
    const lease = wifi.take(state(1));
    const { outcome, command, lobby } = await start(f, wifi, lease);
    wifi.close();
    assert.equal(f.lobbies.view(lobby).status, 'starting');
    usb.take(state(1));
    assert.equal((await outcome).code, 'uncertain');
    assert.equal(f.lobbies.view(lobby).status, 'ready');
    assert.equal(store.db.prepare('SELECT status FROM pending_hardware_starts WHERE command = ?').get(command).status, 'abandoned');
    assert.equal(store.list().length, 0);
  } finally { store.close(); }
});

test('a bridge restart reconciles a persisted pending START without sending it again', async () => {
  const store = new ScoreStore(':memory:');
  try {
    const first = fixture(store);
    const cable = first.connect('usb');
    const lease = cable.take(state(1));
    const { command } = await start(first, cable, lease);
    assert.equal(store.db.prepare('SELECT status FROM pending_hardware_starts WHERE command = ?').get(command).status, 'pending');
    // The first bridge disappears before the matching board response reaches it.
    const reopened = fixture(store);
    const recovered = reopened.connect('usb');
    recovered.take(state(2, { phase: 'ready', command, run: 1 }));
    assert.equal(reopened.bridge.view().state.players.team, 'Kai + Ali');
    assert.equal(store.db.prepare('SELECT status FROM pending_hardware_starts WHERE command = ?').get(command).status, 'confirmed');
    assert.equal(recovered.commands.some(line => line.endsWith(',START')), false);
  } finally { store.close(); }
});

test('a refused START preserves the roster in the lobby without marking it started', async () => {
  const store = new ScoreStore(':memory:');
  try {
    const f = fixture(store);
    const cable = f.connect('usb');
    const lease = cable.take(state(1));
    const { command, outcome, lobby } = await start(f, cable, lease);
    cable.line('@ACK,' + lease + ',' + command + ',REFUSED');
    assert.equal((await outcome).code, 'refused');
    assert.equal(f.lobbies.view(lobby).status, 'ready');
    assert.deepEqual(f.lobbies.view(lobby).players, players);
    assert.equal(store.db.prepare('SELECT status FROM pending_hardware_starts WHERE command = ?').get(command).status, 'abandoned');
  } finally { store.close(); }
});

test('reboot marks the previous outcome unconfirmed without carrying a roster to the new run', async () => {
  const store = new ScoreStore(':memory:');
  try {
    const f = fixture(store);
    const usb = f.connect('usb');
    const lease = usb.take(state(1));
    const { outcome, command } = await start(f, usb, lease);
    usb.line(state(2, { phase: 'playing', run: 1, command }));
    assert.equal((await outcome).ok, true);
    usb.close();
    f.advance(9000);
    assert.equal(f.bridge.view().runStatus, 'unconfirmed');
    const boot = '1111aaaa';
    const restarted = f.connect('usb', boot);
    restarted.take(state(1, { phase: 'playing', run: 1, boot }));
    assert.equal(f.bridge.view().state.players, null);
    assert.match(f.bridge.view().notice, /restarted/);
    assert.equal(store.db.prepare('SELECT status FROM hardware_runs WHERE id = ?').get(identity).status, 'unconfirmed');
    assert.equal(store.list().length, 0);
  } finally { store.close(); }
});

test('score write failure rolls back the hardware result and a later retry commits both', () => {
  const store = new ScoreStore(':memory:');
  try {
    const f = fixture(store);
    const usb = f.connect('usb');
    usb.take(state(1, { phase: 'playing', run: 1 }));
    const set = store.set.bind(store);
    store.set = () => { throw new Error('test write failure'); };
    usb.line(state(2, { phase: 'won', run: 1, seconds: 120 }));
    assert.equal(f.bridge.view().scoreStatus, 'pending');
    assert.equal(store.db.prepare('SELECT status FROM hardware_runs').get().status, 'active');
    assert.deepEqual(store.list(), []);
    store.set = set;
    f.advance(1000);
    assert.equal(f.bridge.view().scoreStatus, 'saved');
    assert.equal(store.db.prepare('SELECT status FROM hardware_runs').get().status, 'won');
    assert.equal(store.list().length, 1);
  } finally { store.close(); }
});

test('a legacy score and the same board result appear once without assigning an unconfirmed roster', () => {
  const store = new ScoreStore(':memory:');
  try {
    const f = fixture(store);
    const usb = f.connect('usb');
    usb.take(state(1, { phase: 'won', run: 1, seconds: 120 }));
    assert.equal(store.list()[0].id, identity);
    const legacy = { id: 'esp32:' + firstBoot + ':1', team: 'Prior Team', defuser: 'Prior', expert: 'Team',
      remaining: 120000, attempts: 0, date: 1000 };
    assert.equal(store.importLegacy([legacy]).imported, 1);
    assert.deepEqual(store.list().map(row => row.team), ['Prior Team']);
    assert.deepEqual(store.history.list(1, 10000).runs.map(row => row.team), ['Prior Team']);
    assert.equal(f.bridge.view().state.players, null);
    assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM scores').get().n, 2);
  } finally { store.close(); }
});

test('RESET waits for its applied snapshot and a missing confirmation expires', async () => {
  const store = new ScoreStore(':memory:');
  try {
    const f = fixture(store);
    const usb = f.connect('usb');
    const lease = usb.take(state(1, { phase: 'lost', run: 1 }));
    const reset = f.bridge.command('RESET', lease, { confirmReset: true });
    const command = usb.commands.at(-1).split(',')[2];
    usb.line('@ACK,' + lease + ',' + command + ',OK');
    assert.equal(f.bridge.view().state.phase, 'lost');
    f.advance(1300);
    f.advance(4100);
    assert.equal((await reset).code, 'uncertain');
    const reopened = f.connect('usb');
    reopened.take(state(2, { phase: 'idle', run: 1, command }));
    assert.equal(f.bridge.view().state.phase, 'idle');
    assert.equal(store.db.prepare('SELECT status FROM hardware_runs').get().status, 'lost');
  } finally { store.close(); }
});

test('a hardware loss replaces its interrupted run and retains the hint and decision counts', t => {
  const store = new ScoreStore(':memory:');
  t.after(() => store.close());
  const f = fixture(store);
  const cable = f.connect('usb');
  cable.take(state(1, { phase: 'playing', run: 1, seconds: 205 }));
  assert.equal(store.history.unlockHint(identity, { level: 1, card: 2, tier: 1 }, 10001).length, 1);
  cable.close();
  f.advance(8500);
  assert.equal(store.history.get(identity, 18500).status, 'interrupted');
  f.connect('usb').take(state(2, { phase: 'lost', run: 1, seconds: 201 }));
  const run = store.history.get(identity, 18500);
  assert.equal(f.bridge.view().scoreStatus, 'saved');
  assert.equal(run.status, 'lost');
  assert.equal(run.hintsUsed, 1);
  assert.equal(run.decisions, 1);
  assert.equal(run.accuracy, 0);
  assert.equal(run.loss, 'WIRE');
  assert.equal(run.score, 0);
  assert.equal(store.history.list(1, 18500).runs.length, 1);
});
