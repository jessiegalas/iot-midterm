import { cardForWire, PRACTICE_CARD, WIRE_COLORS } from './expert-manual.js';

export const MORSE = ['-----', '.----', '..---', '...--', '....-', '.....', '-....', '--...', '---..', '----.'];
export const COLORS = WIRE_COLORS;
export const DURATION = 240000;
export const WIRES_PER_LEVEL = [1, 2, 2];
export const STORAGE_KEY = 'defuse.scores.v1';
export function createLevel(level, rng = Math.random) {
  const pool = COLORS.map((_, index) => index);
  for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
  const required = pool.slice(0, WIRES_PER_LEVEL[level - 1]);
  return { code: Array.from({ length: 4 }, () => Math.floor(rng() * 10)).join(''), required,
    cards: required.map((color, slot) => cardForWire(level, slot, color)), entry: '', solved: false, wrong: 0, pulled: COLORS.map(() => false) };
}
// When a run is driven by the ESP32, the
// board owns the rules and the clock; `base` is the remaining time (ms) the board last reported at `lastAt`.
export function initialGame() {
  return { phase: 'idle', level: 1, remaining: DURATION, attempts: 0, correct: 0, decisions: 0,
    levelsCleared: 0, loss: '', round: null, log: [], team: '', defuser: '', expert: '',
    message: '', lastAt: null, deadline: null, id: null, device: false, practice: false, base: 0 };
}
function log(game, text, tone = 'neutral') { return [{ text, tone, at: game.remaining }, ...game.log].slice(0, 30); }
// crypto.randomUUID only exists in secure contexts (https or localhost); getRandomValues works everywhere.
export function makeId() {
  const c = globalThis.crypto;
  if (c?.randomUUID) return c.randomUUID();
  const bytes = c?.getRandomValues ? c.getRandomValues(new Uint8Array(16)) : Array.from({ length: 16 }, () => Math.floor(Math.random() * 256));
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}
const LOST_TEXT = { CODE: 'Three incorrect codes in one level.', WIRE: 'Wrong wire pulled.', TIME: "Time's up." };

export function applyDeviceSnapshot(game, snapshot, now) {
  const rosterChanged = snapshot.players && (game.defuser !== snapshot.players.defuser || game.expert !== snapshot.players.expert);
  if (!game.device || (game.boardDevice === snapshot.deviceId && game.boardBoot === snapshot.boot &&
    (game.revision > snapshot.revision || (game.revision === snapshot.revision && !rosterChanged)))) return game;
  const board = { device: true, boardDevice: snapshot.deviceId, boardBoot: snapshot.boot, revision: snapshot.revision };
  if (snapshot.phase === 'idle') return { ...initialGame(), ...board };
  const id = snapshot.id ?? `esp32:${snapshot.boot}:${snapshot.run}`;
  const sameRun = game.id === id;
  const players = snapshot.players ?? { team: 'Hardware run', defuser: 'Defuser', expert: 'Expert' };
  const current = { ...(sameRun ? game : initialGame()), ...players };
  const phase = snapshot.phase;
  const remaining = snapshot.remainingMs ?? snapshot.seconds * 1000;
  let message = current.message;
  let activity;
  let tone = 'neutral';

  if (phase !== current.phase || snapshot.level !== current.boardLevel) {
    if (phase === 'ready') activity = snapshot.level === 1 ? 'Device armed.' : 'Timer paused. Seat the wires.';
    if (phase === 'playing') activity = `Level ${snapshot.level} started.`;
    if (phase === 'cleared') activity = `Level ${snapshot.level} cleared. Timer paused.`;
    if (phase === 'won') activity = 'Device defused. Mission accomplished.';
    if (phase === 'lost') activity = LOST_TEXT[snapshot.loss];
    tone = phase === 'lost' ? 'danger' : 'success';
  } else if (phase === 'playing' && snapshot.wrong > current.round?.wrong) {
    activity = `Incorrect code (${snapshot.wrong}/3).`;
    tone = 'danger';
  } else if (phase === 'playing' && snapshot.solved && !current.round?.solved) {
    activity = 'Access code verified.';
    tone = 'success';
  } else if (phase === 'playing' && COLORS.some((_, i) => !current.round?.pulled[i] && snapshot.mask & (1 << i))) {
    activity = 'Correct wire disconnected.';
    tone = 'success';
  }
  if (activity) message = activity;
  if (phase === 'ready') message = snapshot.mask ? 'Seat every wire to continue.' : 'All wires seated. Start when ready.';

  return {
    ...current, ...board, id, phase, level: phase === 'ready' ? snapshot.level - 1 : snapshot.level,
    boardLevel: snapshot.level, remaining, base: remaining, lastAt: now, attempts: snapshot.attempts, message,
    correct: snapshot.correct ?? null, decisions: snapshot.decisions ?? null, loss: snapshot.loss,
    levelsCleared: ['cleared', 'won'].includes(phase) ? snapshot.level : snapshot.level - 1,
    round: { clues: snapshot.clues, cards: snapshot.cards, entry: snapshot.entry, solved: snapshot.solved,
      wrong: snapshot.wrong, pulled: COLORS.map((_, i) => Boolean(snapshot.mask & (1 << i))) },
    log: activity ? log({ ...current, remaining }, activity, tone) : current.log,
  };
}

function finishLevel(game) {
  if (!game.round.solved || !game.round.required.every(i => game.round.pulled[i])) return game;
  if (game.practice) return { ...game, phase: 'won', message: 'You verified the code and pulled the correct wire.' };
  game = { ...game, levelsCleared: game.level };
  if (game.level === 3) return { ...game, phase: 'won', deadline: null, message: 'All three levels cleared.', log: log(game, 'Device defused. Mission accomplished.', 'success') };
  return { ...game, phase: 'ready', deadline: null, message: 'Reconnect every wire before continuing.', log: log(game, `Level ${game.level} cleared. Timer paused.`, 'success') };
}
export function gameReducer(game, action) {
  if (action.type === 'RESET' || action.type === 'HW_DETACH') return initialGame();
  if (action.type === 'HW_SNAPSHOT') return applyDeviceSnapshot(game, action.snapshot, action.now);
  if (action.type === 'HW_ATTACH') return { ...initialGame(), device: true };
  if (action.type === 'START_PRACTICE' && !game.device && game.phase === 'idle') {
    return {
      ...initialGame(), practice: true, phase: 'playing',
      round: {
        code: '0421', required: [PRACTICE_CARD.wireNumber - 1], cards: [PRACTICE_CARD.id],
        entry: '', solved: false, wrong: 0, pulled: COLORS.map(() => false),
      },
    };
  }
  // The board owns the rules, so simulated inputs must never change a hardware run.
  if (game.device && ['KEY', 'WIRE', 'RECONNECT', 'NEXT', 'START', 'ABORT'].includes(action.type)) return game;
  if (action.type === 'START') return { ...initialGame(), ...action.players, phase: 'playing', round: createLevel(1), lastAt: action.now, deadline: action.now + DURATION, id: action.id, log: [{ text: 'Simulation armed. Level 1 started.', tone: 'success', at: DURATION }] };
  if (action.type === 'TICK' && game.phase === 'playing' && game.device) {
    // Smooth the board's once-per-second @TIME between reports; never run past the next snapshot or end the game ourselves.
    const lowerBound = Math.max(0, Math.ceil(game.base / 1000) * 1000 - 999);
    const remaining = Math.max(lowerBound, game.base - Math.max(0, action.now - game.lastAt));
    return remaining === game.remaining ? game : { ...game, remaining };
  }
  if (action.type === 'RECONNECT' && game.phase === 'ready') return { ...game, round: { ...game.round, pulled: game.round.pulled.map((v, i) => i === action.index ? false : v) } };
  if (action.type === 'NEXT' && game.phase === 'ready' && !game.round.pulled.some(Boolean)) return { ...game, phase: 'playing', level: game.level + 1, round: createLevel(game.level + 1), lastAt: action.now, deadline: action.now + game.remaining, message: '', log: log(game, `Level ${game.level + 1} started.`, 'success') };
  if (action.type === 'ABORT' && game.id && ['playing', 'ready'].includes(game.phase)) {
    const checkpoint = gameReducer(game, { type: 'TICK', now: action.now });
    return checkpoint.phase === 'lost' ? checkpoint
      : { ...checkpoint, phase: action.interrupted ? 'interrupted' : 'aborted', deadline: null };
  }
  if (game.phase !== 'playing') return game;
  if (!game.practice && ['TICK', 'KEY', 'WIRE'].includes(action.type)) {
    const now = Math.max(game.lastAt, action.now ?? game.lastAt);
    const remaining = Math.max(0, game.deadline - now);
    if (remaining === 0) {
      return { ...game, remaining, lastAt: now, deadline: null, phase: 'lost', loss: 'TIME', message: "Time's up.",
        log: log({ ...game, remaining }, 'Timer expired. Device detonated.', 'danger') };
    }
    if (now !== game.lastAt) game = { ...game, remaining, lastAt: now };
  }
  if (action.type === 'KEY') {
    const r = game.round;
    if (r.solved) return game;
    if (action.key === '*') return { ...game, round: { ...r, entry: '' }, message: '' };
    if (/^\d$/.test(action.key)) return { ...game, round: { ...r, entry: (r.entry + action.key).slice(0, 4) }, message: '' };
    if (action.key !== '#') return game;
    if (r.entry.length !== 4) return { ...game, message: 'Enter all four digits before submitting.' };
    if (r.entry === r.code) return finishLevel({ ...game, correct: game.correct + 1, decisions: game.decisions + 1,
      round: { ...r, solved: true, entry: '' }, message: 'Code accepted. Complete the wire module.', log: log(game, 'Access code verified.', 'success') });
    if (game.practice) return { ...game, round: { ...r, entry: '' }, message: 'That code didn’t match. Read the Morse groups again in order.' };
    const wrong = r.wrong + 1;
    const lost = wrong >= 3;
    return { ...game, round: { ...r, wrong, entry: '' }, attempts: game.attempts + 1, decisions: game.decisions + 1,
      phase: lost ? 'lost' : 'playing', loss: lost ? 'CODE' : '', deadline: lost ? null : game.deadline,
      message: lost ? 'Three incorrect codes in one level.' : `Incorrect code. ${3 - wrong} attempts remaining.`, log: log(game, `Incorrect code (${wrong}/3).`, 'danger') };
  }
  if (action.type === 'WIRE' && Number.isInteger(action.index) && action.index >= 0 && action.index < COLORS.length && !game.round.pulled[action.index]) {
    if (game.practice && !game.round.required.includes(action.index)) {
      return { ...game, message: 'Try another wire. Use the elimination clues on Test card P.' };
    }
    const r = { ...game.round, pulled: game.round.pulled.map((v, i) => v || i === action.index) };
    if (!r.required.includes(action.index)) return { ...game, round: r, phase: 'lost', loss: 'WIRE',
      deadline: null, decisions: game.decisions + 1, message: `Wrong wire pulled: ${COLORS[action.index].toLowerCase()}.`,
      log: log(game, 'Incorrect wire. Device detonated.', 'danger') };
    return finishLevel({ ...game, round: r, correct: game.correct + 1, decisions: game.decisions + 1,
      message: 'Correct wire disconnected.', log: log(game, `${COLORS[action.index]} wire disconnected.`, 'success') });
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

export function recordWin(scores, game, date) {
  if (game.phase !== 'won' || !game.id || scores.some(score => score.id === game.id)) return scores;
  const { id, team, defuser, expert, remaining, attempts } = game;
  return rankScores([...scores, { id, team, defuser, expert, remaining, attempts, date }]).slice(0, 100);
}
