import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { COLORS } from './game.js';
import { PRACTICE_CARD, RIDDLE_CARDS } from './expert-manual.js';

test('each wire card has one solution matching the ESP32 card bank', () => {
  const sketch = readFileSync(new URL('../../bomb_defusal_final/bomb_defusal_final.ino', import.meta.url), 'utf8');
  const bank = sketch.match(/riddleBank\[10\] = \{([\s\S]*?)\};/)[1];
  const coloursByCard = new Map([...bank.matchAll(/\{(\d+), "([A-Z]+)"\}/g)].map(([, id, colour]) => [Number(id), colour]));
  assert.deepEqual(RIDDLE_CARDS.map(card => card.id), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  const numberSolutions = new Map([
    [1, String(120 * 6).match(/0+$/)[0].length],
    [3, (22 - 2 * 9) / 2],
    [5, [1, 2, 3, 4, 5].find(x => x * x - 10 * x + 21 === 0)],
    [7, 720 / 180],
    [9, [2, 3, 4, 5, 6].find(n => n * (n - 1) / 2 === 15) - 1],
  ]);

  for (const card of RIDDLE_CARDS) {
    if (card.tags) {
      assert.deepEqual(card.tags.map(tag => tag.wire), COLORS);
      const solutions = COLORS.filter(colour => card.tags.filter(tag =>
        tag.colours.includes(colour) !== Boolean(tag.excludes)).length === card.trueCount);
      assert.deepEqual(solutions, [coloursByCard.get(card.id)], 'Card ' + card.id);
    } else {
      assert.equal(COLORS[numberSolutions.get(card.id) - 1], coloursByCard.get(card.id), 'Card ' + card.id);
    }
  }
  assert.equal(PRACTICE_CARD.wireNumber, 18 / 6);
});
