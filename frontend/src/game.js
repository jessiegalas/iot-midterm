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
export function initialGame() { return { phase: 'idle', level: 1, remaining: DURATION, attempts: 0, round: null, log: [], team: '', defuser: '', expert: '', message: '', lastAt: null, id: null }; }
function log(game, text, tone = 'neutral') { return [{ text, tone, at: game.remaining }, ...game.log].slice(0, 30); }
function finishLevel(game) {
  if (!game.round.solved || !game.round.required.every(i => game.round.pulled[i])) return game;
  if (game.level === 3) return { ...game, phase: 'won', message: 'All three levels cleared.', log: log(game, 'Device defused. Mission accomplished.', 'success') };
  return { ...game, phase: 'ready', message: 'Reconnect every wire before continuing.', log: log(game, `Level ${game.level} cleared. Timer paused.`, 'success') };
}
export function gameReducer(game, action) {
  if (action.type === 'RESET') return initialGame();
  if (action.type === 'START') return { ...initialGame(), ...action.players, phase: 'playing', round: createLevel(1), lastAt: action.now, id: action.id, log: [{ text: 'Simulation armed. Level 1 started.', tone: 'success', at: DURATION }] };
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
