#!/usr/bin/env node
import assert from 'node:assert/strict';
import { loadSimulationApi } from './sim-runtime.mjs';

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
assert.ok(monk.xp >= 5, 'healing earns spell XP');

fighter.hp = fighter.maxHp - 5;
fighter.purse = 0;
api.stepTurn();
assert.equal(game.simStats.monkHeals, 2, 'a broke hero still receives care');
assert.equal(game.simStats.monkFees, 3, 'no extra fee without gold');

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
assert.ok(slowMonk.xp >= 4, 'slow earns spell XP');
slowApi.stepTurn();
assert.equal(slowGame.simStats.monkSlows, 1, 'slow has a cooldown');

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
  assert.ok(hireRows.some(row => row.includes('Monk  65c')), `Monk hiring visible at ${width}×${height}`);
}

console.log('Monk healing, fees, XP, slow cooldown, and mobile guild access passed.');
