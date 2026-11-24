export const VERSION = 2;
export const isCommand = value => typeof value === 'string' && /^(START|RESET|ARM|KEY,[0-9*#A-D])$/.test(value);

const hex = (value, length) => typeof value === 'string' && value.length === length && /^[a-f0-9]+$/.test(value);
const integer = (value, min, max) => /^\d{1,10}$/.test(value) && Number(value) >= min && Number(value) <= max;
const phases = new Set(['idle', 'ready', 'playing', 'cleared', 'won', 'lost']);
const morseDigit = /^(?:-{5}|\.{1,5}-{0,4}|-{1,4}\.{1,4})$/;

export function parseFrame(line) {
  const [type, ...values] = line.trimEnd().split(',');
  switch (type) {
    case '@HELLO': {
      const [version, device, boot] = values;
      if (!integer(version, 1, 255)) return null;
      if (Number(version) !== VERSION) return { type: 'hello', version: Number(version) };
      return values.length === 3 && hex(device, 12) && hex(boot, 8)
        ? { type: 'hello', version: VERSION, device, boot } : null;
    }
    case '@TAKEN':
      return values.length === 1 && hex(values[0], 16) ? { type: 'taken', lease: values[0] } : null;
    case '@ACK': {
      const [lease, command, status] = values;
      return values.length === 3 && hex(lease, 16) && hex(command, 16) && ['OK', 'REFUSED'].includes(status)
        ? { type: 'ack', lease, command, ok: status === 'OK' } : null;
    }
    case '@MUSIC': {
      const [boot, run, revision, elapsed] = values;
      if (values.length !== 4 || !hex(boot, 8) || !integer(run, 0, 0xffffffff) ||
        !integer(revision, 0, 0xffffffff) || !integer(elapsed, 0, 239999)) return null;
      return { type: 'music', boot, run: Number(run), revision: Number(revision), elapsed: Number(elapsed) };
    }
    case '@STATE': {
      if (values.length !== 15) return null;
      const [boot, run, revision, phase, level, seconds, entry, wrong, attempts, solved, mask, clueText, cardText, loss, lastCommand] = values;
      if (!hex(boot, 8) || !integer(run, 0, 0xffffffff) || !integer(revision, 0, 0xffffffff) ||
          !phases.has(phase) || !integer(level, 1, 3) || !integer(seconds, 0, 240) || !/^\d{0,4}$/.test(entry) ||
          !integer(wrong, 0, 3) || !integer(attempts, Number(wrong), 9) || !/^[01]$/.test(solved) || !integer(mask, 0, 31) ||
          (phase === 'lost' ? !['TIME', 'WIRE', 'CODE'].includes(loss) : loss !== '') ||
          (lastCommand !== '' && !hex(lastCommand, 16))) return null;
      const clues = clueText ? clueText.split(':') : [];
      const cards = cardText ? cardText.split(':') : [];
      if (phase === 'playing' && !clues.length) return null;
      if ((clues.length && (clues.length !== 4 || clues.some(clue => clue.length !== 5 || !morseDigit.test(clue)))) ||
          (Boolean(cards.length) !== Boolean(clues.length)) || cards.length > 5 ||
          cards.some(card => !integer(card, 1, 10)) || new Set(cards.map(card => Math.floor((Number(card) - 1) / 2))).size !== cards.length) return null;
      return { type: 'state', boot, run: Number(run), revision: Number(revision), phase, level: Number(level),
        seconds: Number(seconds), entry, wrong: Number(wrong), attempts: Number(attempts), solved: solved === '1',
        mask: Number(mask), clues, cards: cards.map(Number), loss, lastCommand };
    }
    default:
      return null;
  }
}

// Both the serial adapter and TLS socket are byte streams. Drop a damaged or
// overlong line through its newline so its suffix cannot be parsed as a frame.
export function readLines(callback, limit = 256) {
  let line = '';
  let overflow = false;
  return chunk => {
    for (const char of chunk.toString('ascii')) {
      if (char === '\n') {
        if (!overflow && line) callback(line);
        line = '';
        overflow = false;
      } else if (!overflow) {
        if (line.length === limit) overflow = true;
        else line += char;
      }
    }
  };
}
