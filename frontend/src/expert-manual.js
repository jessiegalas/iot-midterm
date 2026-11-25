export const PRACTICE_CARD = {
  id: 'P',
  prompt: 'Share 18 tokens equally among 6 teams. How many tokens does each team get? Use that number as your wire number.',
  wireNumber: 3,
};

export const RIDDLE_CARDS = [
  {
    id: 1,
    prompt: 'Find the next term in 1, 2, 6, 24, 120, … Count its trailing zeros. That count is your wire number.',
  },
  {
    id: 2,
    trueCount: 1,
    tags: [
      { wire: 'RED', colours: ['BLACK', 'PURPLE'] },
      { wire: 'BLACK', colours: ['WHITE', 'PURPLE'] },
      { wire: 'BLUE', colours: ['WHITE'], excludes: true },
      { wire: 'WHITE', colours: ['BLUE'] },
      { wire: 'PURPLE', colours: ['RED'], excludes: true },
    ],
  },
  {
    id: 3,
    prompt: 'A barn has chickens and cows. Together they have 9 heads and 22 legs. Use the number of cows as your wire number.',
  },
  {
    id: 4,
    trueCount: 2,
    tags: [
      { wire: 'RED', colours: ['BLACK'], excludes: true },
      { wire: 'BLACK', colours: ['WHITE'] },
      { wire: 'BLUE', colours: ['RED'] },
      { wire: 'WHITE', colours: ['PURPLE'], excludes: true },
      { wire: 'PURPLE', colours: ['BLUE', 'BLACK'] },
    ],
  },
  {
    id: 5,
    prompt: 'Solve x² − 10x + 21 = 0. Use the smaller solution as your wire number.',
    hint: 'Look for two numbers that add to 10 and multiply to 21.',
  },
  {
    id: 6,
    trueCount: 2,
    tags: [
      { wire: 'RED', colours: ['PURPLE'] },
      { wire: 'BLACK', colours: ['BLUE'] },
      { wire: 'BLUE', colours: ['WHITE'] },
      { wire: 'WHITE', colours: ['RED', 'BLACK'] },
      { wire: 'PURPLE', colours: ['BLUE'] },
    ],
  },
  {
    id: 7,
    prompt: 'A polygon’s interior angles add up to 720°. Subtract 2 from its number of sides to get your wire number.',
    hint: 'For a polygon with n sides, the sum is (n − 2) × 180°.',
  },
  {
    id: 8,
    trueCount: 3,
    tags: [
      { wire: 'RED', colours: ['WHITE'] },
      { wire: 'BLACK', colours: ['WHITE', 'PURPLE'] },
      { wire: 'BLUE', colours: ['WHITE'], excludes: true },
      { wire: 'WHITE', colours: ['BLACK'] },
      { wire: 'PURPLE', colours: ['RED', 'WHITE'] },
    ],
  },
  {
    id: 9,
    prompt: 'At a party, every pair of people shakes hands exactly once. There are 15 handshakes. Subtract 1 from the number of people to get your wire number.',
  },
  {
    id: 10,
    trueCount: 1,
    tags: [
      { wire: 'RED', colours: ['WHITE', 'BLACK'] },
      { wire: 'BLACK', colours: ['PURPLE'], excludes: true },
      { wire: 'BLUE', colours: ['WHITE'] },
      { wire: 'WHITE', colours: ['BLUE', 'BLACK'] },
      { wire: 'PURPLE', colours: ['BLUE'], excludes: true },
    ],
  },
];

export function cardNumber(id) {
  return typeof id === 'number' ? String(id).padStart(2, '0') : id;
}

export function tagStatement(tag) {
  return 'Correct wire is ' + (tag.excludes ? 'NOT ' : '') + tag.colours.join(' or ') + '.';
}
