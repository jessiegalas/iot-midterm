export const WIRE_COLORS = ['RED', 'BLACK', 'BLUE', 'WHITE', 'PURPLE'];

export const HINT_COSTS = [5, 10];

const showColors = colors => new Intl.ListFormat('en', { type: 'conjunction' }).format(colors);
const ruleOut = colors => 'Rule out ' + showColors(colors) + '.';

function eliminationCard(id, wireNumber, excluded) {
  const remaining = WIRE_COLORS.filter(color => !excluded.slice(0, 2).flat().includes(color));
  return {
    id, wireNumber, kind: 'elimination', excluded,
    clues: excluded.map(ruleOut),
    hints: [
      'Start by crossing out ' + showColors(excluded[0]) + '.',
      'After the first two clues, check the last clue against ' + showColors(remaining) + '.',
    ],
  };
}

function mixedCard(id, wireNumber, numberClue, nudge, candidates, excluded) {
  return {
    id, wireNumber, kind: 'mixed', candidates, excluded,
    clues: [numberClue, ...excluded.map(ruleOut)],
    hints: [
      nudge,
      'Start with ' + showColors(candidates.map(number => WIRE_COLORS[number - 1])) + '. Apply the next two clues.',
    ],
  };
}

export const PRACTICE_CARD = eliminationCard('P', 3, [['RED', 'WHITE'], ['BLACK'], ['PURPLE']]);

export const RIDDLE_CARDS = [
  {
    id: 1, wireNumber: 1, kind: 'number',
    prompt: 'Find the next number in 1, 2, 6, 24, 120, … Count the zeros at the end. Use that count as your wire number.',
    hints: [
      'Look at what you multiply by to get from one number to the next.',
      'Multiply by 2, then 3, then 4, and keep going.',
    ],
  },
  eliminationCard(2, 1, [['BLACK', 'PURPLE'], ['BLUE'], ['WHITE']]),
  {
    id: 3, wireNumber: 2, kind: 'number',
    prompt: 'A barn has chickens and cows. Together they have 9 heads and 22 legs. Use the number of cows as your wire number.',
    hints: [
      'Start with 9 chickens. How many legs would they have?',
      'Nine chickens would have 18 legs. Swapping a chicken for a cow adds 2 legs.',
    ],
  },
  eliminationCard(4, 2, [['RED', 'BLUE'], ['WHITE'], ['PURPLE']]),
  {
    id: 5, wireNumber: 3, kind: 'number',
    prompt: 'Solve x² − 10x + 21 = 0. Use the smaller solution as your wire number.',
    hints: [
      'List positive factor pairs of 21.',
      'Choose the factor pair that adds to 10. The smaller factor is the smaller solution.',
    ],
  },
  eliminationCard(6, 3, [['RED', 'PURPLE'], ['BLACK'], ['WHITE']]),
  {
    id: 7, wireNumber: 4, kind: 'number',
    prompt: 'A polygon’s interior angles add up to 720°. Subtract 2 from its number of sides to get your wire number.',
    hints: [
      'A polygon’s angle sum is (number of sides − 2) × 180°.',
      'Divide 720° by 180° to find the number of triangles. The polygon has two more sides than that.',
    ],
  },
  eliminationCard(8, 4, [['RED', 'BLACK'], ['BLUE'], ['PURPLE']]),
  {
    id: 9, wireNumber: 5, kind: 'number',
    prompt: 'At a party, every pair of people shakes hands exactly once. There are 15 handshakes. Subtract 1 from the number of people to get your wire number.',
    hints: [
      'Try a group size. Count only handshakes with people you have not counted yet.',
      'With 5 people there are 4 + 3 + 2 + 1 handshakes. Try a group with one more person.',
    ],
  },
  eliminationCard(10, 5, [['BLUE', 'WHITE'], ['RED'], ['BLACK']]),
  mixedCard(11, 1, 'The wire number is odd.', 'Circle the odd numbers in the wire chart.', [1, 3, 5], [['BLUE'], ['PURPLE']]),
  mixedCard(12, 2, 'The wire number is less than 4.', 'Start at wire 1 and stop before wire 4 in the chart.', [1, 2, 3], [['RED'], ['BLUE']]),
  mixedCard(13, 3, 'The wire number is odd.', 'Circle the odd numbers in the wire chart.', [1, 3, 5], [['RED'], ['PURPLE']]),
  mixedCard(14, 4, 'The wire number is greater than 2.', 'Start after wire 2 in the chart.', [3, 4, 5], [['BLUE'], ['PURPLE']]),
  mixedCard(15, 5, 'The wire number is odd.', 'Circle the odd numbers in the wire chart.', [1, 3, 5], [['RED'], ['BLUE']]),
];

export const LEVEL_CARD_KINDS = [
  ['elimination'],
  ['elimination', 'number'],
  ['number', 'mixed'],
];

const cardsByKind = Object.fromEntries(['elimination', 'number', 'mixed'].map(kind => [
  kind, RIDDLE_CARDS.filter(card => card.kind === kind),
]));

export function cardForWire(level, slot, wireIndex) {
  return cardsByKind[LEVEL_CARD_KINDS[level - 1][slot]][wireIndex].id;
}

export function cardNumber(id) {
  return typeof id === 'number' ? String(id).padStart(2, '0') : id;
}
