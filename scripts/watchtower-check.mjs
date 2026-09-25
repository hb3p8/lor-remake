#!/usr/bin/env node
import assert from 'node:assert/strict';
import { loadSimulationApi } from './sim-runtime.mjs';

const api = loadSimulationApi({ viewportWidth: 390, viewportHeight: 844 });
const cell = (x, y) => y * 100 + x;

function road(g, m, x, y) {
  const i = cell(x, y);
  assert.equal(g.visible[i], 0, 'test road must start outside current sight');
  m.tiles[y][x] = 'ROAD';
  g.playerRoadRefs[i] = 1;
  g.roadCellSeen[i] = 1;
  g.roadCellsEver.push(i);
}

api.newGame(2222, { render: true, manual: true });
let g = api._goalProbeGame(), m = api._map();
assert.equal(m.tiles[17][74], 'GRASS');
road(g, m, 79, 17);
g.coin = 100;
// A short touch opens the tile panel and its actual build action.
let found = false;
const layout = api.menuState();
for (let row = 0; row < layout.viewRows && !found; row++) {
  for (let col = 0; col < layout.viewCols; col++) {
    const p = api.worldCellAt(col, row);
    if (p && p.x === 74 && p.y === 17) {
      assert.equal(api.worldTap(col, row, 'touch'), 'tile');
      const buildRow = api.menuRows().findIndex(line => line.includes('Watchtower 50c'));
      assert(buildRow >= 0);
      api.menuTap(1, buildRow);
      found = true;
      break;
    }
  }
}
assert(found, 'watchtower must be reachable from the mobile map');
assert.equal(g.coin, 50);
assert.equal(g.visible[cell(79, 17)], 1, 'tower sight must reach the exposed road');
assert.equal(api._buildWatchtower(74, 17), false, 'tower cannot be bought twice');
assert.match(api._canFound(74, 17).reason, /watchtower/);
assert(api.menuRows().some(line => line.includes('WATCHTOWER')));
for (let turn = 100; turn < 1100; turn++) {
  g.turn = turn;
  assert.equal(api._spawnRoadBandit(), false, 'watched road cannot generate bandits');
}
api.menuTap(1, 0); // close the tile panel before resolving a sub-turn

const raider = g.hostiles.find(h => h.alive && h.kind === 'bandit');
assert(raider);
raider.x = 75; raider.y = 17;
raider.originX = 75; raider.originY = 17;
raider.territory = 3;
raider.goal = { type: 'prowl', target: { x: 74, y: 17 },
  path: [{ x: 74, y: 17 }], utility: 100, reason: 'watchtower' };
api._stepSubTurn();
api._resolveWatchtowerRaids();
assert.equal(g.watchtowers[0].hp, 24, 'a nearby guard can intercept the attacker');
for (const a of g.actors) if (a.role === 'guard') { a.x = g.castle.x; a.y = g.castle.y; }
assert.equal(g.watchtowerCells[cell(74, 17)], 1, 'a hostile cannot raze the tower on entry');
assert.equal(g.watchtowers[0].hp, 24);
for (let hit = 1; hit <= 4; hit++) {
  api._resolveWatchtowerRaids();
  if (hit < 4) {
    assert.equal(g.watchtowerCells[cell(74, 17)], 1);
    assert.equal(g.watchtowers[0].hp, 24 - hit * 6);
    assert.equal(g.visible[cell(79, 17)], 1, 'damaged tower must keep its sight');
  }
}
assert.equal(g.watchtowerCells[cell(74, 17)], 0, 'tower falls after four unopposed hits');
assert.equal(g.visible[cell(79, 17)], 0, 'destroyed tower loses its sight');

api.newGame(2222, { render: false, manual: true });
g = api._goalProbeGame(); m = api._map();
for (let x = 79; x <= 84; x++) road(g, m, x, 17);
let spawned = false;
for (let turn = 100; turn < 1100 && !spawned; turn++) {
  g.turn = turn;
  spawned = api._spawnRoadBandit();
}
assert(spawned, 'an unseen road should eventually get an ambush');
const bandit = g.hostiles.find(h => h.roadAmbusher && h.alive);
assert(bandit);
assert.equal(bandit.territory, 6);
assert.equal(m.tiles[bandit.y][bandit.x], 'ROAD');
const patrol = api._hostileDiag(bandit.id);
assert.equal(patrol.awake, true, 'road bandits patrol even before an actor arrives');
assert(patrol.cands.some(c => c.type === 'prowl' && c.pathLen > 1), 'patrol must have a reachable road leg');
const beforePatrol = { x: bandit.x, y: bandit.y };
api._stepSubTurn();
assert(bandit.x !== beforePatrol.x || bandit.y !== beforePatrol.y, 'ambusher must actually patrol');
assert(Math.abs(bandit.x - bandit.originX) + Math.abs(bandit.y - bandit.originY) <= 6,
  'road patrol must stay close to its origin');
const cartX = bandit.x === 84 ? 83 : bandit.x + 1;
g.actors.push({ id: 'test-cart', name: 'Test cart', alive: true, cart: true,
  x: cartX, y: 17, hp: 4, maxHp: 4 });
assert(api._hostileDiag(bandit.id).cands.some(c => c.type === 'stalk' && c.tx === cartX && c.ty === 17),
  'ambusher must notice a nearby cart');

console.log('Watchtower sight, cost, touch tile view, HP damage, spawn protection and road ambush AI: OK');
