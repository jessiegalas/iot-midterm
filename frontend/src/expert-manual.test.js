import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { COLORS } from './game.js';
import { cardForWire, LEVEL_CARD_KINDS, PRACTICE_CARD, RIDDLE_CARDS } from './expert-manual.js';

test('every card has one solution and the deck matches the ESP32', () => {
  const sketch = readFileSync(new URL('../../bomb_defusal_final/bomb_defusal_final.ino', import.meta.url), 'utf8');
  const bank = sketch.match(/CARDS_BY_KIND\[\]\[NUM_WIRES\] = \{([\s\S]*?)\};/)[1];
  const decks = [...bank.matchAll(/\{([\d, ]+)\}/g)].map(([, row]) => row.split(',').map(Number));
  const kinds = ['elimination', 'number', 'mixed'];
  const levelKinds = sketch.match(/CARD_KINDS_BY_LEVEL\[\]\[2\] = \{([\s\S]*?)\};/)[1];
  const boardPacing = [...levelKinds.matchAll(/\{([A-Z_, ]+)\}/g)].map(([, row], index) =>
    row.split(',').slice(0, index === 0 ? 1 : 2).map(kind => kind.trim().replace('_CARD', '').toLowerCase()));
  assert.deepEqual(boardPacing, LEVEL_CARD_KINDS);
  assert.equal(RIDDLE_CARDS.length, 15);
  for (const [index, kind] of kinds.entries()) {
    assert.deepEqual(decks[index], RIDDLE_CARDS.filter(card => card.kind === kind).map(card => card.id));
  }

  const numberSolutions = new Map([
    [1, String(120 * 6).match(/0+$/)[0].length],
    [3, (22 - 2 * 9) / 2],
    [5, [1, 2, 3, 4, 5].find(x => x * x - 10 * x + 21 === 0)],
    [7, 720 / 180],
    [9, [1, 2, 3, 4, 5, 6].find(n => n * (n - 1) / 2 === 15) - 1],
  ]);
  for (const card of [...RIDDLE_CARDS, PRACTICE_CARD]) {
    assert.equal(card.hints.length, 2);
    if (card.kind === 'number') {
      assert.equal(card.wireNumber, numberSolutions.get(card.id));
    } else {
      assert.equal(card.clues.length, 3);
      const candidates = COLORS.filter((color, index) => {
        const n = index + 1;
        const firstClue = card.clues[0];
        const eligible = card.kind === 'elimination' ||
          (firstClue.includes('odd') && n % 2 === 1) ||
          (firstClue.includes('less than 4') && n < 4) ||
          (firstClue.includes('greater than 2') && n > 2);
        return eligible && !card.excluded.flat().includes(color);
      });
      assert.deepEqual(candidates, [COLORS[card.wireNumber - 1]], 'Card ' + card.id);
    }
    if (card.id !== 'P') assert.equal(decks[kinds.indexOf(card.kind)][card.wireNumber - 1], card.id);
  }
  assert.equal(PRACTICE_CARD.wireNumber, 3);

  for (const [index, slots] of LEVEL_CARD_KINDS.entries()) {
    slots.forEach((kind, slot) => COLORS.forEach((_, wire) =>
      assert.equal(cardForWire(index + 1, slot, wire), decks[kinds.indexOf(kind)][wire])));
  }
});
