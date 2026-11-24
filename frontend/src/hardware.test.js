import assert from 'node:assert/strict';
import test from 'node:test';
import { parseFrame, readLines } from '../server/protocol.js';
import { gameReducer, initialGame, recordWin } from './game.js';

const playing = '@STATE,20a1b3c4,8,9,playing,2,175,01,1,2,0,24,-----:.----:..---:...--,2:4:6:8:10,,';
const apply = (game, frame, now = 100) => gameReducer(game, { type: 'HW_SNAPSHOT', snapshot: parseFrame(frame), now });

test('valid hardware snapshots carry every color and recognize all ten cards', () => {
  assert.deepEqual(parseFrame(playing).cards, [2, 4, 6, 8, 10]);
  assert.deepEqual(parseFrame(playing.replace('2:4:6:8:10', '1:3:5:7:9')).cards, [1, 3, 5, 7, 9]);
  for (const malformed of [playing.replace(',24,', ',32,'), playing.replace(':10', ':11'),
    playing.replace(':10', ':7'), playing.replace('-----', '---..-')]) {
    assert.equal(parseFrame(malformed), null);
  }
  const initial = gameReducer(initialGame(), { type: 'HW_ATTACH' });
  const game = apply(initial, playing);
  assert.deepEqual(game.round.pulled, [false, false, false, true, true]);
  assert.deepEqual(game.round.clues, ['-----', '.----', '..---', '...--']);
  assert.equal(game.round.entry, '01');
  assert.equal(game.remaining, 175000);
  assert.equal(game.round.code, undefined);
  assert.equal(gameReducer(game, { type: 'WIRE', index: 3 }), game);
});

test('a resumed winning snapshot records one score under the original board run ID', () => {
  let game = gameReducer(initialGame(), { type: 'HW_ATTACH' });
  game = gameReducer(game, { type: 'HW_BEGIN', players: { team: 'Team', expert: 'E', defuser: 'D' } });
  game = apply(game, playing);
  const won = '@STATE,20a1b3c4,8,14,won,3,63,,0,2,1,16,-----:.----:..---:...--,10,,';
  game = apply(game, won);
  const scores = recordWin([], game, 1);
  assert.equal(scores[0].team, 'Team');
  assert.equal(scores[0].remaining, 63000);
  assert.equal(scores[0].attempts, 2);
  assert.equal(apply(game, won), game);
  assert.equal(apply(game, playing), game);
  const reload = apply(gameReducer(initialGame(), { type: 'HW_ATTACH' }), won);
  assert.equal(recordWin(scores, reload, 2), scores);
  const restarted = apply(game, '@STATE,70a1b3c4,0,1,idle,1,240,,0,0,0,0,,,,');
  assert.equal(restarted.phase, 'idle');
  assert.equal(restarted.id, null);
});

test('stream parser handles fragmented frames and skips long lines through the newline', () => {
  const lines = [];
  const feed = readLines(line => lines.push(line), 12);
  feed(Buffer.from('1234567891234'));
  feed(Buffer.from('@SYNC\n@HELL'));
  feed(Buffer.from('O,1\r\n'));
  assert.deepEqual(lines.map(parseFrame), [{ type: 'hello', version: 1 }]);
});
