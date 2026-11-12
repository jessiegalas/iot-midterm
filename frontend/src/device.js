// Pure helpers for the ESP32 USB-serial protocol. The matching firmware side is the
// "HOST LINK" block in bomb_defusal_final/bomb_defusal_final.ino.
//
// Device -> host lines start with "@". Anything else the sketch prints (debug text,
// the ESP32 boot banner) is ignored.

export const COMMANDS = {
  sync: 'SYNC',
  start: 'START',
  reset: 'RESET',
  arm: 'ARM',
  key(k) {
    if (!/^[0-9*#A-D]$/.test(k)) throw new Error(`Invalid key: ${k}`);
    return `KEY,${k}`;
  },
};

const num = s => (typeof s === 'string' && /^\d{1,6}$/.test(s) ? Number(s) : null);
const inRange = (n, lo, hi) => n !== null && n >= lo && n <= hi;
const bits = m => [0, 1, 2].filter(i => m & (1 << i));

// Returns an event object, or null for anything that is not a well-formed protocol line.
export function parseLine(raw) {
  if (typeof raw !== 'string') return null;
  const at = raw.indexOf('@'); // tolerate boot-time garbage in front of the marker
  if (at < 0) return null;
  const [name, ...a] = raw.slice(at + 1).replace(/[\r\n]+$/, '').split(',');
  switch (name) {
    case 'HELLO': {
      const version = num(a[0]);
      return version === null ? null : { type: 'HELLO', version };
    }
    case 'IDLE':
      return { type: 'IDLE' };
    case 'READY': {
      const [level, missing, seconds] = [num(a[0]), num(a[1]), num(a[2])];
      return inRange(level, 1, 3) && inRange(missing, 0, 7) && seconds !== null && a.length === 3
        ? { type: 'READY', level, missing, seconds } : null;
    }
    case 'LEVEL': {
      const [level, mask, seconds] = [num(a[0]), num(a[2]), num(a[4])];
      const cards = (a[3] || '').split(':').map(num);
      const required = inRange(mask, 1, 7) ? bits(mask) : [];
      if (!inRange(level, 1, 3) || !/^\d{4}$/.test(a[1] || '') || seconds === null || a.length !== 5) return null;
      if (!required.length || cards.length !== required.length || !cards.every(c => inRange(c, 1, 6))) return null;
      // Every card must belong to one of the required wires (card 1-2 RED, 3-4 BLACK, 5-6 BLUE).
      if (!cards.every(c => required.includes(Math.floor((c - 1) / 2)))) return null;
      return { type: 'LEVEL', level, code: a[1], required, cards, seconds };
    }
    case 'ENTRY':
      return a.length === 1 && /^\d{0,4}$/.test(a[0]) ? { type: 'ENTRY', entry: a[0] } : null;
    case 'CODE': {
      if (a[0] === 'OK' && a.length === 1) return { type: 'CODE', ok: true };
      const wrong = num(a[1]);
      return a[0] === 'BAD' && a.length === 2 && inRange(wrong, 1, 3) ? { type: 'CODE', ok: false, wrong } : null;
    }
    case 'WIRE': {
      const index = num(a[0]);
      return inRange(index, 0, 2) && (a[1] === 'OK' || a[1] === 'BAD') && a.length === 2
        ? { type: 'WIRE', index, ok: a[1] === 'OK' } : null;
    }
    case 'CLEAR': {
      const level = num(a[0]);
      return inRange(level, 1, 3) && a.length === 1 ? { type: 'CLEAR', level } : null;
    }
    case 'TIME': {
      const seconds = num(a[0]);
      return seconds !== null && a.length === 1 ? { type: 'TIME', seconds } : null;
    }
    case 'PROGRESS': {
      const [solved, wrong, pulled] = [num(a[1]), num(a[2]), num(a[3])];
      return a.length === 4 && /^\d{0,4}$/.test(a[0]) && inRange(solved, 0, 1) && inRange(wrong, 0, 3) && inRange(pulled, 0, 7)
        ? { type: 'PROGRESS', entry: a[0], solved: solved === 1, wrong, pulled } : null;
    }
    case 'WON': {
      const seconds = num(a[0]);
      return seconds !== null && a.length === 1 ? { type: 'WON', seconds } : null;
    }
    case 'LOST':
      return a.length === 1 && ['CODE', 'WIRE', 'TIME'].includes(a[0]) ? { type: 'LOST', reason: a[0] } : null;
    default:
      return null;
  }
}
