export const MORSE = ['-----', '.----', '..---', '...--', '....-', '.....', '-....', '--...', '---..', '----.'];
export const COLORS = ['RED', 'BLACK', 'BLUE'];
export const DURATION = 240000;
export const STORAGE_KEY = 'defuse.scores.v1';
export const RIDDLES = [
  { id: 1, color: 'RED', text: 'I stop the traffic, paint the rose, and flush a cheek when anger grows.' },
  { id: 2, color: 'RED', text: 'A ruby holds my fiery glow. A warning tells you not to go.' },
  { id: 3, color: 'BLACK', text: 'When every light has gone to sleep, I am the shade the shadows keep.' },
  { id: 4, color: 'BLACK', text: 'Find me in ink and in the night. I swallow every ray of light.' },
  { id: 5, color: 'BLUE', text: 'Above the clouds, below the sea, a cloudless sky looks just like me.' },
  { id: 6, color: 'BLUE', text: 'A sapphire wears my ocean hue. The deepest water gives this clue.' },
];
export function createLevel(level, rng = Math.random) {
  const pool = [0, 1, 2];
  for (let i = 2; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
  const required = pool.slice(0, level);
  return { code: Array.from({ length: 4 }, () => Math.floor(rng() * 10)).join(''), required,
    cards: required.map(c => c * 2 + 1 + Math.floor(rng() * 2)), entry: '', solved: false, wrong: 0, pulled: [false, false, false] };
}
// `device` is true while the run is driven by the ESP32 over USB serial (see device.js). In that mode the
// board owns the rules and the clock; `base` is the remaining time (ms) the board last reported at `lastAt`.
export function initialGame() { return { phase: 'idle', level: 1, remaining: DURATION, attempts: 0, round: null, log: [], team: '', defuser: '', expert: '', message: '', lastAt: null, id: null, device: false, base: 0 }; }
function log(game, text, tone = 'neutral') { return [{ text, tone, at: game.remaining }, ...game.log].slice(0, 30); }
// crypto.randomUUID only exists in secure contexts (https or localhost); getRandomValues works everywhere.
export function makeId() {
  const c = globalThis.crypto;
  if (c?.randomUUID) return c.randomUUID();
  const bytes = c?.getRandomValues ? c.getRandomValues(new Uint8Array(16)) : Array.from({ length: 16 }, () => Math.floor(Math.random() * 256));
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}
const blankRound = () => ({ code: '', required: [], cards: [], entry: '', solved: false, wrong: 0, pulled: [false, false, false] });
const maskBits = m => [0, 1, 2].map(i => Boolean(m & (1 << i)));
const isLive = g => g.phase === 'playing' || g.phase === 'ready';
const LOST_TEXT = { CODE: 'Three incorrect codes in one level.', WIRE: 'Wrong wire pulled.', TIME: "Time's up." };
const hardwareRun = id => ({ ...initialGame(), device: true, team: 'Hardware run', defuser: 'Defuser', expert: 'Expert', id });
// Folds one parsed device event (device.js parseLine) into the game state. Pure: `now` and `id` come from the caller.
export function applyDeviceEvent(game, ev, now, id) {
  const ms = ev.seconds * 1000;
  switch (ev.type) {
    case 'IDLE':
      return isLive(game) ? { ...initialGame(), device: true, message: 'Device returned to standby.' } : game;
    case 'READY':
    case 'LEVEL': {
      // Continue our own run (pending lobby start or live game); anything else is a run the board started itself.
      const g = game.device && game.id && game.phase !== 'won' && game.phase !== 'lost' ? game : hardwareRun(id);
      if (ev.type === 'LEVEL') return { ...g, device: true, phase: 'playing', level: ev.level, remaining: ms, base: ms, lastAt: now, message: '',
        round: { code: ev.code, required: ev.required, cards: ev.cards, entry: '', solved: false, wrong: 0, pulled: [false, false, false] }, log: log(g, `Level ${ev.level} started.`, 'success') };
      const first = g.phase !== 'ready';
      const msg = ev.missing ? 'Seat every wire to continue.' : ev.level === 1 ? 'All wires seated. Press A on the device, or Start.' : 'All wires seated. Ready for the next level.';
      return { ...g, device: true, phase: 'ready', level: ev.level - 1, remaining: ms, base: ms, message: msg,
        round: { ...(g.round || blankRound()), entry: '', pulled: maskBits(ev.missing) },
        log: first ? log(g, ev.level === 1 ? 'Device armed. Seat the wires to begin.' : 'Timer paused. Seat the wires.', 'success') : g.log };
    }
    case 'TIME':
      return isLive(game) ? { ...game, remaining: ms, base: ms, lastAt: now } : game;
    case 'WON':
      return isLive(game) ? { ...game, phase: 'won', remaining: ms, message: 'All three levels cleared.', log: log(game, 'Device defused. Mission accomplished.', 'success') } : game;
    case 'LOST':
      return isLive(game) ? { ...game, phase: 'lost', remaining: ev.reason === 'TIME' ? 0 : game.remaining, message: LOST_TEXT[ev.reason], log: log(game, ev.reason === 'TIME' ? 'Timer expired. Device detonated.' : ev.reason === 'WIRE' ? 'Incorrect wire. Device detonated.' : 'Third incorrect code. Device detonated.', 'danger') } : game;
  }
  if (game.phase !== 'playing' || !game.round) return game;
  const r = game.round;
  switch (ev.type) {
    case 'ENTRY':
      return { ...game, round: { ...r, entry: ev.entry } };
    case 'CODE':
      if (ev.ok) return r.solved ? game : { ...game, round: { ...r, solved: true, entry: '' }, message: 'Code accepted. Complete the wire module.', log: log(game, 'Access code verified.', 'success') };
      return { ...game, round: { ...r, wrong: ev.wrong, entry: '' }, attempts: game.attempts + 1, message: ev.wrong >= 3 ? LOST_TEXT.CODE : `Incorrect code. ${3 - ev.wrong} attempts remaining.`, log: log(game, `Incorrect code (${ev.wrong}/3).`, 'danger') };
    case 'WIRE': {
      const next = { ...r, pulled: r.pulled.map((v, i) => v || i === ev.index) };
      return ev.ok
        ? { ...game, round: next, message: 'Correct wire disconnected.', log: log(game, `${COLORS[ev.index]} wire disconnected.`, 'success') }
        : { ...game, round: next, message: `Wrong wire pulled: ${COLORS[ev.index].toLowerCase()}.`, log: log(game, `${COLORS[ev.index]} wire pulled. Not a target.`, 'danger') };
    }
    case 'CLEAR':
      return { ...game, message: ev.level < 3 ? 'Level cleared. Reconnect every wire.' : '', log: log(game, `Level ${ev.level} cleared.`, 'success') };
    case 'PROGRESS': // sent when we join a game that is already under way
      return { ...game, attempts: Math.max(game.attempts, ev.wrong), round: { ...r, entry: ev.entry, solved: ev.solved, wrong: ev.wrong, pulled: maskBits(ev.pulled) } };
    default:
      return game;
  }
}
function finishLevel(game) {
  if (!game.round.solved || !game.round.required.every(i => game.round.pulled[i])) return game;
  if (game.level === 3) return { ...game, phase: 'won', message: 'All three levels cleared.', log: log(game, 'Device defused. Mission accomplished.', 'success') };
  return { ...game, phase: 'ready', message: 'Reconnect every wire before continuing.', log: log(game, `Level ${game.level} cleared. Timer paused.`, 'success') };
}
export function gameReducer(game, action) {
  if (action.type === 'RESET') return { ...initialGame(), device: game.device }; // stay in hardware mode while the USB link is up
  if (action.type === 'DEVICE') return applyDeviceEvent(game, action.event, action.now, action.id);
  // USB link opened: drop any simulated run, then let the board's SYNC reply rebuild the state.
  if (action.type === 'HW_ATTACH') return { ...initialGame(), device: true };
  // Lobby submit in hardware mode: remember the team and wait for the board's @READY.
  if (action.type === 'HW_BEGIN') return { ...initialGame(), ...action.players, device: true, id: action.id, message: 'Waiting for the device…' };
  if (action.type === 'HW_DETACH') return game.device && isLive(game) ? { ...initialGame(), message: 'Device disconnected. The run was abandoned.' } : { ...game, device: false };
  // The board owns the rules, so simulated inputs must never change a hardware run.
  if (game.device && ['KEY', 'WIRE', 'RECONNECT', 'NEXT', 'START'].includes(action.type)) return game;
  if (action.type === 'START') return { ...initialGame(), ...action.players, phase: 'playing', round: createLevel(1), lastAt: action.now, id: action.id, log: [{ text: 'Simulation armed. Level 1 started.', tone: 'success', at: DURATION }] };
  if (action.type === 'TICK' && game.phase === 'playing' && game.device) {
    // Smooth the board's once-per-second @TIME between reports; never run past the next report or end the game ourselves.
    const remaining = Math.max(Math.max(0, game.base - 999), game.base - Math.max(0, action.now - game.lastAt));
    return remaining === game.remaining ? game : { ...game, remaining };
  }
  if (action.type === 'TICK' && game.phase === 'playing') {
    const remaining = Math.max(0, game.remaining - Math.max(0, action.now - game.lastAt));
    return { ...game, remaining, lastAt: action.now, ...(remaining === 0 ? { phase: 'lost', message: "Time's up.", log: log(game, 'Timer expired. Device detonated.', 'danger') } : {}) };
  }
  if (action.type === 'RECONNECT' && game.phase === 'ready') return { ...game, round: { ...game.round, pulled: game.round.pulled.map((v, i) => i === action.index ? false : v) } };
  if (action.type === 'NEXT' && game.phase === 'ready' && !game.round.pulled.some(Boolean)) return { ...game, phase: 'playing', level: game.level + 1, round: createLevel(game.level + 1), lastAt: action.now, message: '', log: log(game, `Level ${game.level + 1} started.`, 'success') };
  if (game.phase !== 'playing') return game;
  if (action.type === 'KEY') {
    const r = game.round;
    if (r.solved) return game;
    if (action.key === '*') return { ...game, round: { ...r, entry: '' }, message: '' };
    if (/^\d$/.test(action.key)) return { ...game, round: { ...r, entry: (r.entry + action.key).slice(0, 4) }, message: '' };
    if (action.key !== '#') return game;
    if (r.entry.length !== 4) return { ...game, message: 'Enter all four digits before submitting.' };
    if (r.entry === r.code) return finishLevel({ ...game, round: { ...r, solved: true, entry: '' }, message: 'Code accepted. Complete the wire module.', log: log(game, 'Access code verified.', 'success') });
    const wrong = r.wrong + 1;
    return { ...game, round: { ...r, wrong, entry: '' }, attempts: game.attempts + 1, phase: wrong >= 3 ? 'lost' : 'playing', message: wrong >= 3 ? 'Three incorrect codes in one level.' : `Incorrect code. ${3 - wrong} attempts remaining.`, log: log(game, `Incorrect code (${wrong}/3).`, 'danger') };
  }
  if (action.type === 'WIRE' && !game.round.pulled[action.index]) {
    const r = { ...game.round, pulled: game.round.pulled.map((v, i) => v || i === action.index) };
    if (!r.required.includes(action.index)) return { ...game, round: r, phase: 'lost', message: `Wrong wire pulled: ${COLORS[action.index].toLowerCase()}.`, log: log(game, 'Incorrect wire. Device detonated.', 'danger') };
    return finishLevel({ ...game, round: r, message: 'Correct wire disconnected.', log: log(game, `${COLORS[action.index]} wire disconnected.`, 'success') });
  }
  return game;
}
export function rankScores(scores, filter = 'all', now = Date.now()) {
  return [...scores].filter(s => filter === 'all' || now - s.date <= (filter === 'day' ? 86400000 : 604800000)).sort((a,b) => b.remaining - a.remaining || a.attempts - b.attempts || a.date - b.date);
}
export function loadScores(storage) {
  try { const rows = JSON.parse(storage.getItem(STORAGE_KEY) || '[]'); return Array.isArray(rows) ? rows.filter(s => s && typeof s.id === 'string' && ['team','defuser','expert'].every(k => typeof s[k] === 'string') && Number.isFinite(s.remaining) && s.remaining > 0 && s.remaining <= DURATION && Number.isInteger(s.attempts) && s.attempts >= 0 && Number.isFinite(s.date)).slice(0, 100) : []; } catch { return []; }
}
export function clock(ms) { const s = Math.floor(ms / 1000); return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; }
