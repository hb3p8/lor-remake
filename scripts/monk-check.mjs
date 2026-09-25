#!/usr/bin/env node
import assert from 'node:assert/strict';
import { loadSimulationApi } from './sim-runtime.mjs';

{
  const buildApi = loadSimulationApi();
  buildApi.newGame(2222, { manual: true });
  const buildGame = buildApi._goalProbeGame();
  buildGame.coin = 200;
  assert.equal(buildApi.manualBuild('monks'), true);
  assert.equal(buildGame.coin, 120);
  buildApi.runTurns(2);
  assert.ok(buildGame.built.includes('monks'), 'Monastery completes in two big turns');
  assert.equal(buildApi.manualHire('monk'), true);
  assert.equal(buildApi.snapshot().heroes.monk, 1);
}

const api = loadSimulationApi();
api.newGame(2222, { manual: true });
const game = api._goalProbeGame();
game.built.push('fighters', 'monks');
game.coin = 500;
assert.equal(api.manualHire('fighter'), true);
assert.equal(api.manualHire('monk'), true);
const fighter = game.actors.find(a => a.role === 'fighter');
const monk = game.actors.find(a => a.role === 'monk');
assert.ok(monk.heroUid && monk.heroUid !== fighter.heroUid);
assert.ok(monk.atk < fighter.atk && monk.maxHp < fighter.maxHp);
game.hostiles.length = 0;
const cols = api._map().tiles[0].length;
const near = game.caches.passable.find(cell => {
  const x = cell % cols, y = (cell / cols) | 0;
  return Math.max(Math.abs(x - game.castle.x), Math.abs(y - game.castle.y)) === 1;
});
assert.notEqual(near, undefined);
fighter.x = near % cols;
fighter.y = (near / cols) | 0;
fighter.steps = 0; // keep this patient in spell range during the controlled turn
fighter.hp = fighter.maxHp - 5;
fighter.purse = 3;
const goldBefore = fighter.purse + monk.purse;
const mintedBefore = game.wildGold;
api.stepTurn();
assert.equal(game.simStats.monkHeals, 1, 'one spell per big turn');
assert.equal(game.simStats.monkHealHp, 5);
assert.equal(game.simStats.monkFees, 3);
assert.equal(fighter.hp, fighter.maxHp);
assert.equal(fighter.purse + monk.purse, goldBefore, 'healing transfers existing hero gold');
assert.equal(game.wildGold, mintedBefore, 'healing mints no gold');
assert.equal(monk.xp, 30, 'healing earns 6 XP for each HP actually restored');

fighter.hp = fighter.maxHp - 5;
fighter.purse = 0;
api.stepTurn();
assert.equal(game.simStats.monkHeals, 2, 'a broke hero still receives care');
assert.equal(game.simStats.monkFees, 3, 'no extra fee without gold');

monk.level = 3;
fighter.maxHp = 40;
fighter.hp = 20;
api.stepTurn();
assert.equal(game.simStats.monkHealHp, 20, 'level 3 heals up to 10 HP, after two earlier 5 HP heals');
assert.equal(fighter.hp, 30);
assert.equal(game.simStats.monkSpellXp, 120, 'stronger heal also grants doubled XP for HP restored');

monk.level = 6;
fighter.hp = 10;
game.turn++;
api._stepSubTurn();
assert.equal(game.simStats.monkHealHp, 36, 'level 6 heal caps at 16 HP');

const slowApi = loadSimulationApi();
slowApi.newGame(1151, { manual: true });
const slowGame = slowApi._goalProbeGame();
slowGame.built.push('monks');
slowGame.coin = 200;
assert.equal(slowApi.manualHire('monk'), true);
const slowMonk = slowGame.actors.find(a => a.role === 'monk');
slowGame.actors = [slowMonk];
slowMonk.maxHp = 100;
slowMonk.hp = 100;
const foe = slowGame.hostiles[0];
assert.ok(foe);
slowGame.hostiles = [foe];
foe.x = slowGame.castle.x + 1;
foe.y = slowGame.castle.y;
foe.originX = foe.x;
foe.originY = foe.y;
foe.raider = true;
foe.hp = 100;
foe.maxHp = 100;
slowApi.stepTurn();
assert.equal(slowGame.simStats.monkSlows, 1);
assert.equal(slowMonk.slowReadyTurn, slowGame.turn + 3);
assert.ok(slowMonk.xp >= 24, 'slow earns doubled spell XP');
slowApi.stepTurn();
assert.equal(slowGame.simStats.monkSlows, 1, 'slow has a cooldown');

function firstPursuit(blockSpell, level = 1) {
  const probe = loadSimulationApi();
  probe.newGame(1151, { manual: true });
  const g = probe._goalProbeGame();
  g.built.push('monks');
  g.coin = 200;
  assert.equal(probe.manualHire('monk'), true);
  const healer = g.actors.find(a => a.role === 'monk');
  healer.level = level;
  g.actors = [healer];
  healer.x = g.castle.x + 2;
  healer.y = g.castle.y;
  const pursuer = g.hostiles[0];
  g.hostiles = [pursuer];
  pursuer.x = g.castle.x + 3;
  pursuer.y = g.castle.y;
  pursuer.originX = pursuer.x;
  pursuer.originY = pursuer.y;
  pursuer.raider = true;
  pursuer.territory = 99;
  pursuer.steps = 4;
  pursuer.hp = pursuer.maxHp = 100;
  g.turn = 2;
  if (blockSpell) healer.lastSpellTurn = 2;
  probe._stepSubTurn();
  assert.equal(healer.x, g.castle.x, 'monk retreats to the keep');
  return { pursuerX: pursuer.x, slowTurns: pursuer.slowTurns || 0 };
}
const slowed = firstPursuit(false), plain = firstPursuit(true);
assert.ok(slowed.pursuerX > plain.pursuerX, 'slowed enemy covers less ground during the escape');
assert.equal(slowed.slowTurns, 3, 'slow persists after the casting sub-turn');
assert.equal(firstPursuit(false, 3).slowTurns, 5, 'level 3 slow lasts 6 sub-turns including the casting turn');
assert.equal(firstPursuit(false, 6).slowTurns, 8, 'level 6 slow lasts 9 sub-turns including the casting turn');

{
  const probe = loadSimulationApi();
  probe.newGame(2222, { manual: true });
  const g = probe._goalProbeGame();
  const map = probe._map();
  g.built.push('rangers', 'fighters', 'monks');
  g.coin = 500;
  assert.equal(probe.manualHire('ranger'), true);
  assert.equal(probe.manualHire('fighter'), true);
  assert.equal(probe.manualHire('monk'), true);
  const ranger = g.actors.find(a => a.role === 'ranger');
  const fighter = g.actors.find(a => a.role === 'fighter');
  const healer = g.actors.find(a => a.role === 'monk');
  assert.equal(healer.steps, ranger.steps, 'monk carries the same movement budget as a ranger');
  const from = { x: g.castle.x, y: g.castle.y };
  const to = { x: from.x + 1, y: from.y };
  for (const tile of ['PLAINS', 'FOREST', 'DEEPWOOD']) {
    map.tiles[to.y][to.x] = tile;
    const rangerCost = probe._stepCostForActor(ranger, from, to);
    const monkCost = probe._stepCostForActor(healer, from, to);
    if (tile === 'PLAINS') assert.equal(monkCost, rangerCost, 'same movement off woodland');
    else assert.ok(monkCost > rangerCost, `${tile} costs the monk more movement`);
    if (tile === 'FOREST') assert.ok(probe._stepCostForActor(healer, from, to, false)
      > probe._stepCostForActor(ranger, from, to, false), 'forest penalty affects actual movement');
  }
  g.hostiles.length = 0;
  fighter.x = from.x + 1; fighter.y = from.y;
  ranger.x = from.x + 2; ranger.y = from.y;
  map.tiles[ranger.y][ranger.x] = 'PLAINS';
  assert.equal(probe._goalProbeChoose(healer).targetId, fighter.heroUid, 'monk initially follows fighter');
  ranger.hp = Math.max(1, Math.floor(ranger.maxHp * 0.4));
  g.turn++;
  assert.equal(probe._goalProbeChoose(healer).targetId, ranger.heroUid, 'nearby wounded ally interrupts support commitment');
}

{
  const probe = loadSimulationApi();
  probe.newGame(2222, { manual: true });
  const g = probe._goalProbeGame();
  const map = probe._map();
  g.built.push('fighters', 'monks');
  g.coin = 500;
  assert.equal(probe.manualHire('fighter'), true);
  assert.equal(probe.manualHire('monk'), true);
  const fighter = g.actors.find(a => a.role === 'fighter');
  const healer = g.actors.find(a => a.role === 'monk');
  g.actors = [fighter, healer];
  fighter.x = g.castle.x + 1; fighter.y = g.castle.y;
  healer.x = g.castle.x + 2; healer.y = g.castle.y;
  fighter.steps = 0;
  fighter.hp = Math.max(1, Math.floor(fighter.maxHp * 0.4));
  const foe = g.hostiles[0];
  g.hostiles = [foe];
  foe.x = g.castle.x + 2; foe.y = g.castle.y + 1;
  foe.originX = foe.x; foe.originY = foe.y;
  foe.hp = foe.maxHp = 100;
  for (const actor of [fighter, healer, foe]) map.tiles[actor.y][actor.x] = 'PLAINS';
  g.turn = 2;
  probe._stepSubTurn();
  assert.equal(g.simStats.monkHeals, 1, 'critical ally is healed while both heroes are threatened');
assert.equal(g.simStats.monkSlows, 0, 'adjacent slow yields to the critical heal');
}

{
  const probe = loadSimulationApi();
  probe.newGame(2222, { manual: true });
  const g = probe._goalProbeGame();
  g.built.push('monks');
  g.coin = 200;
  assert.equal(probe.manualHire('monk'), true);
  const healer = g.actors.find(a => a.role === 'monk');
  const guard = g.actors.find(a => a.role === 'guard');
  g.hostiles.length = 0;
  healer.steps = 0;
  guard.steps = 0;
  healer.x = g.castle.x + 1;
  healer.hp = healer.maxHp - 5;
  healer.purse = 9;
  g.turn = 2;
  probe._stepSubTurn();
  assert.equal(healer.hp, healer.maxHp, 'monk heals themself away from a haven');
  assert.equal(healer.purse, 9, 'self-healing does not transfer gold');
  assert.equal(g.simStats.monkHeals, 1);
  assert.equal(healer.xp, 30, 'self-healing earns spell XP');

  healer.x = g.castle.x;
  healer.goal = null;
  guard.hp = guard.maxHp - 5;
  g.turn = 3;
  probe._stepSubTurn();
  assert.equal(guard.hp, guard.maxHp, 'monk heals a wounded guard at the keep');
  assert.equal(g.simStats.monkHeals, 2);
  assert.equal(g.simStats.monkFees, 0, 'guards receive free treatment');
  assert.equal(healer.xp, 60, 'guard treatment earns spell XP');
}

{
  const probe = loadSimulationApi();
  probe.newGame(2222, { manual: true });
  const g = probe._goalProbeGame();
  g.built.push('monks', 'rangers');
  g.coin = 500;
  assert.equal(probe.manualHire('monk'), true);
  const healer = g.actors.find(a => a.role === 'monk');
  g.hostiles.length = 0;
  const startX = healer.x, startY = healer.y;
  probe._stepSubTurn();
  assert.equal(healer.goal.type, 'explore', 'unaccompanied monk takes an ordinary hero errand');
  assert.ok(healer.x !== startX || healer.y !== startY, 'unaccompanied monk moves on their own');
  assert.equal(probe.manualHire('ranger'), true);
  const ranger = g.actors.find(a => a.role === 'ranger');
  assert.equal(probe._goalProbeChoose(healer).targetId, ranger.heroUid,
    'monk switches from a solo errand to supporting a new hero');
}

{
  const sleepApi = loadSimulationApi();
  sleepApi.newGame(2222, { manual: true });
  const g = sleepApi._goalProbeGame();
  const cols = sleepApi._map().tiles[0].length;
  const farCell = g.caches.passable.find(cell => {
    const x = cell % cols, y = (cell / cols) | 0;
    return Math.max(Math.abs(x - g.castle.x), Math.abs(y - g.castle.y)) > 20;
  });
  assert.notEqual(farCell, undefined);
  const h = g.hostiles[0];
  g.hostiles = [h];
  h.x = farCell % cols;
  h.y = (farCell / cols) | 0;
  h.raider = false;
  h.slowTurns = 2;
  sleepApi._stepSubTurn();
  assert.equal(h.slowTurns, 1);
  sleepApi._stepSubTurn();
  assert.equal(h.slowTurns, 0, 'slow expires even while an enemy sleeps');
}

for (const [width, height] of [[320, 280], [390, 375], [390, 667]]) {
  const ui = loadSimulationApi({ viewportWidth: width, viewportHeight: height });
  ui.newGame(2222, { manual: true });
  const g = ui._goalProbeGame();
  g.coin = 200;
  ui.selectCity();
  const rows = ui.menuRows();
  assert.ok(rows.some(row => row.includes('Monastery')), `Monastery build visible at ${width}×${height}`);
  if (height < 560) {
    ui.menuTap(3, 16);
    assert.equal(g.building.id, 'monks', 'compact build row is tappable');
    g.building = null;
    g.built.push('monks');
    g.coin = 200;
    ui.selectCity();
    ui.menuTap(30, 4);
  } else {
    g.built.push('monks');
    ui.selectCity();
  }
  const hireRows = ui.menuRows();
  assert.ok(hireRows.some(row => row.includes('Monk  50c')), `Monk hiring visible at ${width}×${height}`);
  if (height >= 667) {
    assert.equal(ui.manualHire('monk'), true);
    const hiredMonk = g.actors.find(a => a.role === 'monk');
    hiredMonk.level = 3;
    ui.selectHero('monk');
    const detailRows = ui.menuRows();
    assert.ok(detailRows.some(row => row.includes('Heal ≤10 HP · Slow 6 moments')), 'character view shows level-scaled spells');
  }
}

console.log('Monk healing priority, support switch, woodland pace, spells, and mobile access passed.');
