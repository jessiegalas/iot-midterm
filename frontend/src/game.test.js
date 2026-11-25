import test from 'node:test';
import assert from 'node:assert/strict';
import { COLORS, createLevel, gameReducer, initialGame, loadScores, rankScores, recordWin, DURATION } from './game.js';
const start = () => gameReducer(initialGame(), {type:'START', players:{team:'Test',defuser:'A',expert:'B'},now:1000,id:'run-1'});
function code(g, digits = g.round.code) { for(const key of digits + '#') g = gameReducer(g,{type:'KEY',key}); return g; }
function clear(g) { g = code(g); for(const index of g.round.required) g=gameReducer(g,{type:'WIRE',index}); return g; }
test('a complete three-level run requires reconnecting wires and wins with the shared timer', () => {
  let g = start();
  g = gameReducer(g,{type:'TICK',now:11000});
  g = clear(g); assert.equal(g.phase,'ready'); assert.equal(g.remaining,DURATION-10000);
  assert.equal(gameReducer(g,{type:'NEXT',now:20000}),g);
  for(let level=2; level<=3; level++) {
    for(let index=0; index<COLORS.length; index++) g=gameReducer(g,{type:'RECONNECT',index});
    g=gameReducer(g,{type:'NEXT',now:level*20000});
    assert.equal(g.level,level); assert.equal(g.round.required.length,2); assert.equal(g.round.wrong,0);
    g=clear(g);
  }
  assert.equal(g.phase,'won'); assert.equal(g.remaining,DURATION-10000);
});
test('wrong wire immediately loses; repeated inputs after the result do nothing', () => {
  let g=start(); const wrong=[0,1,2].find(i=>!g.round.required.includes(i));
  g=gameReducer(g,{type:'WIRE',index:wrong}); assert.equal(g.phase,'lost');
  assert.equal(gameReducer(g,{type:'KEY',key:'1'}),g);
});
test('partial entries do not cost strikes; the third incorrect full code loses', () => {
  let g=start(); g=gameReducer(g,{type:'KEY',key:'#'}); assert.equal(g.round.wrong,0);
  const wrong=g.round.code==='0000'?'1111':'0000';
  g=code(g,wrong); assert.equal(g.phase,'playing');assert.equal(g.round.wrong,1);
  g=code(g,wrong);g=code(g,wrong);assert.equal(g.phase,'lost');assert.equal(g.attempts,3);
});
test('timer uses elapsed time, pauses between levels, and resumes without charging paused time', () => {
  let g=start();g=gameReducer(g,{type:'TICK',now:9000});assert.equal(g.remaining,232000);
  g=clear(g);assert.equal(gameReducer(g,{type:'TICK',now:90000}),g);
  for(let index=0;index<COLORS.length;index++)g=gameReducer(g,{type:'RECONNECT',index});
  g=gameReducer(g,{type:'NEXT',now:100000});g=gameReducer(g,{type:'TICK',now:101000});assert.equal(g.remaining,231000);
  g=gameReducer(g,{type:'TICK',now:400000});assert.equal(g.remaining,0);assert.equal(g.phase,'lost');
});
test('correct code preserves leading zeros and either module can be completed first', () => {
  let g=start();g={...g,round:{...g.round,code:'0012'}};
  for(const index of g.round.required) g=gameReducer(g,{type:'WIRE',index});
  assert.equal(g.phase,'playing');g=code(g,'0012');assert.equal(g.phase,'ready');
});
test('level generation has unique wires and cards with corresponding colors', () => {
  const round = createLevel(3, () => 0);
  assert.equal(round.pulled.length, 5);
  assert.deepEqual(round.required, [1, 2]);
  assert.ok(createLevel(3, () => .6).required.includes(4));
  for(let level=1;level<=3;level++)for(let n=0;n<30;n++){
    const r=createLevel(level);assert.equal(new Set(r.required).size,Math.min(level, 2));assert.match(r.code,/^\d{4}$/);
    r.cards.forEach((card,i)=>assert.equal(Math.floor((card-1)/2),r.required[i]));
  }
});

test('the rehearsal is untimed, allows retries, and produces no score', () => {
  let game = gameReducer(initialGame(), { type: 'START_PRACTICE' });
  assert.deepEqual(game.round.cards, ['P']);
  assert.equal(game.deadline, null);
  assert.equal(gameReducer(game, { type: 'TICK', now: DURATION * 3 }), game);
  for (let attempt = 0; attempt < 4; attempt++) game = code(game, '0000');
  assert.equal(game.phase, 'playing');
  assert.equal(game.attempts, 0);
  game = gameReducer(game, { type: 'WIRE', index: 0 });
  assert.equal(game.phase, 'playing');
  assert.ok(game.round.pulled.every(pulled => !pulled));
  game = gameReducer(code(game, '0421'), { type: 'WIRE', index: 2 });
  assert.equal(game.phase, 'won');
  assert.deepEqual(recordWin([], game, Date.now()), []);
  assert.deepEqual(gameReducer(game, { type: 'RESET' }), initialGame());
});
test('leaderboard sorts by time then errors and filters recent runs', () => {
  const now=1000000000;const rows=[{id:'a',remaining:3000,attempts:2,date:now},{id:'b',remaining:4000,attempts:2,date:now-90000000},{id:'c',remaining:3000,attempts:1,date:now}];
  assert.deepEqual(rankScores(rows).map(r=>r.id),['b','c','a']);assert.deepEqual(rankScores(rows,'day',now).map(r=>r.id),['c','a']);
});
test('malformed or unavailable local storage cannot break loading', () => {
  for(const value of ['not json','{}','[null,{},1]'])assert.deepEqual(loadScores({getItem:()=>value}),[]);
  assert.deepEqual(loadScores({getItem:()=>{throw new Error('denied');}}),[]);
});
test('final keypad and wire inputs use the deadline even when a timer tick is delayed', () => {
  let game = { ...start(), level: 3 };
  const wire = game.round.required[0];
  for (const digit of game.round.code) game = gameReducer(game, { type: 'KEY', key: digit, now: 1100 });
  const readyForKey = gameReducer(game, { type: 'WIRE', index: wire, now: 1200 });
  const readyForWire = gameReducer(game, { type: 'KEY', key: '#', now: 1200 });
  for (const [before, input] of [[readyForKey, { type: 'KEY', key: '#' }], [readyForWire, { type: 'WIRE', index: wire }]]) {
    const winning = gameReducer(before, { ...input, now: before.deadline - 1 });
    assert.equal(winning.phase, 'won');
    assert.equal(winning.remaining, 1);
    for (const now of [before.deadline, before.deadline + 50]) {
      const lost = gameReducer(before, { ...input, now });
      assert.equal(lost.phase, 'lost');
      assert.equal(lost.remaining, 0);
      assert.equal(gameReducer(lost, { ...input, now: now + 1 }), lost);
    }
  }
});
