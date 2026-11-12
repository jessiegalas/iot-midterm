import test from 'node:test';
import assert from 'node:assert/strict';
import { COMMANDS, parseLine } from './device.js';
import { gameReducer, initialGame, makeId, DURATION } from './game.js';

const feed = (g, lines, now = 0, id = 'dev-1') => lines.reduce((s, line) => {
  const event = parseLine(line);
  assert.ok(event, `line should parse: ${line}`);
  return gameReducer(s, { type: 'DEVICE', event, now, id });
}, g);
const begin = () => gameReducer(initialGame(), { type: 'HW_BEGIN', players: { team: 'Team', defuser: 'A', expert: 'B' }, id: 'run-1' });

test('parser accepts every protocol line the sketch prints', () => {
  assert.deepEqual(parseLine('@HELLO,1'), { type: 'HELLO', version: 1 });
  assert.deepEqual(parseLine('@IDLE'), { type: 'IDLE' });
  assert.deepEqual(parseLine('@READY,2,5,236'), { type: 'READY', level: 2, missing: 5, seconds: 236 });
  assert.deepEqual(parseLine('@LEVEL,2,0412,5,1:5,236'), { type: 'LEVEL', level: 2, code: '0412', required: [0, 2], cards: [1, 5], seconds: 236 });
  assert.deepEqual(parseLine('@ENTRY,'), { type: 'ENTRY', entry: '' });
  assert.deepEqual(parseLine('@ENTRY,04'), { type: 'ENTRY', entry: '04' });
  assert.deepEqual(parseLine('@CODE,OK'), { type: 'CODE', ok: true });
  assert.deepEqual(parseLine('@CODE,BAD,2'), { type: 'CODE', ok: false, wrong: 2 });
  assert.deepEqual(parseLine('@WIRE,1,OK'), { type: 'WIRE', index: 1, ok: true });
  assert.deepEqual(parseLine('@WIRE,2,BAD'), { type: 'WIRE', index: 2, ok: false });
  assert.deepEqual(parseLine('@CLEAR,3'), { type: 'CLEAR', level: 3 });
  assert.deepEqual(parseLine('@TIME,199'), { type: 'TIME', seconds: 199 });
  assert.deepEqual(parseLine('@PROGRESS,43,1,2,5'), { type: 'PROGRESS', entry: '43', solved: true, wrong: 2, pulled: 5 });
  assert.deepEqual(parseLine('@WON,87'), { type: 'WON', seconds: 87 });
  assert.deepEqual(parseLine('@LOST,TIME'), { type: 'LOST', reason: 'TIME' });
});

test('parser tolerates line endings and boot noise, and ignores everything else', () => {
  assert.deepEqual(parseLine('@IDLE\r'), { type: 'IDLE' });
  assert.deepEqual(parseLine('\u0000� junk@TIME,12\r'), { type: 'TIME', seconds: 12 });
  for (const text of ['', 'Code: 1234', 'LEVEL 1', 'Required colors: RED BLACK', 'ets Jun  8 2016 00:22:57', 'EXPLODED: TIME\'S UP']) assert.equal(parseLine(text), null);
  assert.equal(parseLine(undefined), null);
  assert.equal(parseLine(42), null);
});

test('parser rejects malformed or out-of-range lines instead of guessing', () => {
  const bad = [
    '@HELLO', '@HELLO,x', '@READY,0,0,240', '@READY,4,0,240', '@READY,1,8,240', '@READY,1,0', '@READY,1,0,240,9',
    '@LEVEL,1,123,2,3,240',            // code must be four digits
    '@LEVEL,1,1234,0,3,240',           // no required wire
    '@LEVEL,1,1234,2,1,240',           // card 1 is RED but the mask asks for BLACK
    '@LEVEL,2,1234,3,1,240',           // one card for two wires
    '@LEVEL,1,1234,2,7,240',           // card out of range
    '@ENTRY,12345', '@ENTRY,ab', '@ENTRY,1,2', '@CODE', '@CODE,BAD', '@CODE,BAD,0', '@CODE,BAD,4', '@CODE,MAYBE',
    '@WIRE,3,OK', '@WIRE,1,MAYBE', '@WIRE,-1,OK', '@CLEAR,0', '@TIME,-1', '@TIME,1.5', '@PROGRESS,1,2,0,0', '@WON', '@LOST,FIRE', '@NOPE,1',
  ];
  for (const line of bad) assert.equal(parseLine(line), null, line);
});

test('commands are fixed strings, and only real keypad keys can be sent', () => {
  assert.deepEqual([COMMANDS.sync, COMMANDS.start, COMMANDS.reset, COMMANDS.arm], ['SYNC', 'START', 'RESET', 'ARM']);
  for (const k of '0123456789*#ABCD') assert.equal(COMMANDS.key(k), `KEY,${k}`);
  for (const k of ['', 'E', '12', 'a', '\n', ',']) assert.throws(() => COMMANDS.key(k));
});

test('a full hardware run: lobby start, three levels, win with the board\'s time', () => {
  let g = begin();
  assert.equal(g.device, true);
  g = feed(g, ['@READY,1,3,240'], 100);
  assert.equal(g.phase, 'ready'); assert.equal(g.level, 0); assert.equal(g.team, 'Team'); assert.equal(g.id, 'run-1');
  assert.deepEqual(g.round.pulled, [true, true, false]); assert.equal(g.remaining, 240000);
  g = feed(g, ['@READY,1,0,240'], 200);
  assert.deepEqual(g.round.pulled, [false, false, false]); assert.equal(g.log.length, 1);

  g = feed(g, ['@LEVEL,1,0012,2,3,240'], 300);
  assert.equal(g.phase, 'playing'); assert.equal(g.level, 1); assert.deepEqual(g.round.required, [1]); assert.deepEqual(g.round.cards, [3]);
  g = feed(g, ['@ENTRY,0', '@ENTRY,00', '@ENTRY,0012'], 400);
  assert.equal(g.round.entry, '0012');
  g = feed(g, ['@CODE,OK', '@ENTRY,', '@WIRE,1,OK', '@CLEAR,1', '@READY,2,2,236'], 500);
  assert.equal(g.round.solved, true); assert.equal(g.round.entry, ''); assert.equal(g.phase, 'ready'); assert.equal(g.level, 1);
  assert.deepEqual(g.round.pulled, [false, true, false]); assert.equal(g.remaining, 236000);
  g = feed(g, ['@READY,2,0,236'], 600);

  g = feed(g, ['@LEVEL,2,1234,5,1:5,236', '@CODE,BAD,1', '@ENTRY,', '@CODE,OK', '@WIRE,0,OK', '@WIRE,2,OK', '@CLEAR,2', '@READY,3,0,200'], 700);
  assert.equal(g.attempts, 1); assert.equal(g.phase, 'ready'); assert.equal(g.level, 2);

  g = feed(g, ['@LEVEL,3,9876,7,1:3:5,200', '@CODE,OK', '@WIRE,0,OK', '@WIRE,1,OK', '@WIRE,2,OK', '@CLEAR,3', '@WON,187'], 800);
  assert.equal(g.phase, 'won'); assert.equal(g.remaining, 187000); assert.equal(g.attempts, 1); assert.equal(g.id, 'run-1');
});

test('each way to lose is reported with its own message', () => {
  const playing = () => feed(begin(), ['@READY,1,0,240', '@LEVEL,1,0000,1,1,240', '@TIME,90']);
  let g = feed(playing(), ['@WIRE,2,BAD', '@LOST,WIRE']);
  assert.equal(g.phase, 'lost'); assert.match(g.message, /wrong wire/i); assert.equal(g.round.pulled[2], true);
  g = feed(playing(), ['@CODE,BAD,1', '@CODE,BAD,2', '@CODE,BAD,3', '@LOST,CODE']);
  assert.equal(g.phase, 'lost'); assert.equal(g.attempts, 3); assert.match(g.message, /three incorrect/i);
  g = feed(playing(), ['@LOST,TIME']);
  assert.equal(g.phase, 'lost'); assert.equal(g.remaining, 0); assert.match(g.message, /time/i);
});

test('the clock follows the board: smoothed between reports, never ends the game on its own', () => {
  let g = feed(begin(), ['@READY,1,0,240', '@LEVEL,1,0000,1,1,240', '@TIME,100'], 5000);
  g = gameReducer(g, { type: 'TICK', now: 5400 }); assert.equal(g.remaining, 99600);
  g = gameReducer(g, { type: 'TICK', now: 9000 }); assert.equal(g.remaining, 99001); assert.equal(g.phase, 'playing');
  g = feed(g, ['@TIME,99'], 9500); assert.equal(g.remaining, 99000);
  g = feed(g, ['@TIME,1'], 20000);
  g = gameReducer(g, { type: 'TICK', now: 90000 }); assert.equal(g.remaining, 1); assert.equal(g.phase, 'playing');
  const same = gameReducer(g, { type: 'TICK', now: 90100 }); assert.equal(same, g);
});

test('a run started on the board itself, and a second run after a result, get their own ids', () => {
  let g = feed(initialGame(), ['@READY,1,3,240'], 0, 'dev-1');
  assert.equal(g.phase, 'ready'); assert.equal(g.team, 'Hardware run'); assert.equal(g.id, 'dev-1'); assert.deepEqual(g.round.pulled, [true, true, false]);
  g = feed(g, ['@READY,1,0,240', '@LEVEL,1,0000,1,1,240', '@LOST,TIME'], 0, 'ignored');
  assert.equal(g.id, 'dev-1');
  g = feed(g, ['@READY,1,0,240'], 0, 'dev-2');
  assert.equal(g.phase, 'ready'); assert.equal(g.id, 'dev-2'); assert.equal(g.attempts, 0); assert.equal(g.log.length, 1);
});

test('joining a game that is already under way rebuilds it from the board\'s SYNC reply', () => {
  let g = feed(initialGame(), ['@HELLO,1', '@LEVEL,2,4321,3,1:3,150', '@PROGRESS,43,1,2,1'], 0);
  assert.equal(g.phase, 'playing'); assert.equal(g.level, 2); assert.equal(g.remaining, 150000);
  assert.equal(g.round.entry, '43'); assert.equal(g.round.solved, true); assert.equal(g.round.wrong, 2); assert.equal(g.attempts, 2);
  assert.deepEqual(g.round.pulled, [true, false, false]);
  g = feed(initialGame(), ['@READY,2,4,120']);
  assert.equal(g.phase, 'ready'); assert.equal(g.level, 1); assert.equal(g.remaining, 120000); assert.deepEqual(g.round.pulled, [false, false, true]);
});

test('stray events never invent a result or a run', () => {
  const idle = gameReducer(initialGame(), { type: 'HW_ATTACH' });
  for (const line of ['@WON,100', '@LOST,TIME', '@TIME,10', '@ENTRY,12', '@CODE,OK', '@WIRE,0,OK', '@CLEAR,1', '@PROGRESS,1,1,0,0', '@IDLE']) assert.equal(feed(idle, [line]), idle, line);
  const pending = begin();
  assert.equal(feed(pending, ['@IDLE']), pending); // late @IDLE from a RESET must not wipe a lobby start
  const live = feed(pending, ['@READY,1,0,240']);
  const back = feed(live, ['@IDLE']);
  assert.equal(back.phase, 'idle'); assert.equal(back.device, true); assert.equal(back.id, null);
});

test('simulated inputs cannot touch a hardware run, and unplugging keeps results but abandons live runs', () => {
  const live = feed(begin(), ['@READY,1,0,240', '@LEVEL,1,0000,1,1,240']);
  for (const action of [{ type: 'KEY', key: '1' }, { type: 'WIRE', index: 0 }, { type: 'RECONNECT', index: 0 }, { type: 'NEXT', now: 1 }, { type: 'START', players: {}, now: 1, id: 'x' }]) assert.equal(gameReducer(live, action), live);
  const gone = gameReducer(live, { type: 'HW_DETACH' });
  assert.equal(gone.phase, 'idle'); assert.equal(gone.device, false); assert.match(gone.message, /disconnected/i);
  const won = feed(live, ['@CODE,OK', '@WIRE,0,OK', '@CLEAR,3', '@WON,50']);
  const kept = gameReducer(won, { type: 'HW_DETACH' });
  assert.equal(kept.phase, 'won'); assert.equal(kept.remaining, 50000); assert.equal(kept.device, false);
  assert.equal(gameReducer(initialGame(), { type: 'HW_ATTACH' }).remaining, DURATION);
});

test('makeId works without randomUUID (plain http on a LAN address) and without crypto at all', () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
  const set = value => Object.defineProperty(globalThis, 'crypto', { value, configurable: true, writable: true });
  try {
    set({ getRandomValues: a => { a.fill(171); return a; } });
    assert.equal(makeId(), 'ab'.repeat(16));
    set(undefined);
    const ids = new Set(Array.from({ length: 50 }, makeId));
    assert.equal(ids.size, 50);
    for (const id of ids) assert.match(id, /^[0-9a-f]{32}$/);
  } finally {
    if (original) Object.defineProperty(globalThis, 'crypto', original); else delete globalThis.crypto;
  }
  assert.ok(makeId().length >= 32);
});
