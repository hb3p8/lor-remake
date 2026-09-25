#!/usr/bin/env node
import assert from 'node:assert/strict';
import { loadSimulationApi } from './sim-runtime.mjs';

const api = loadSimulationApi();
const seeds = [587033999, 1592594996, 25, 1151, 2222];

for (const seed of seeds) {
  for (const scenario of ['freeplay', 'charter', 'convoy', 'marches', 'winter', 'ore', 'crypt', 'bandits', 'trade']) {
    const snapshot = api.newGame(seed, { scenario, manual: true });
    const game = api._goalProbeGame();
    assert.equal(snapshot.scenarioId, scenario);
    assert.equal(snapshot.gameOver, false);
    if (scenario !== 'convoy') assert.equal(snapshot.scenarioProgress.target, undefined);
    if (scenario === 'freeplay') {
      const expected = ((seed ^ (seed >>> 16) ^ 0xBADD17) & 3) === 0 ? 1 : 0;
      assert.equal(game.lairs.filter(l => l.type === 'bandit').length, expected);
      assert.equal(game.otherHoldings.length, expected);
    }
    if (scenario === 'ore') {
      const cell = game.scenario.targetCell;
      assert.equal(game.richSites[cell], 3);
      game.discovered.fill(1);
      const x = cell % api._map().tiles[0].length;
      const y = (cell / api._map().tiles[0].length) | 0;
      assert.deepEqual({ ...api.snapshot().scenarioProgress.target }, { x, y });
      assert.equal(api.manualCanFoundVillage(x, y, 'mine').ok, true);
    }
    if (scenario === 'crypt') {
      assert.ok(game.lairs.some(l => l.id === game.scenario.targetLairId && l.type === 'undead'));
    }
    if (scenario === 'bandits') {
      const keep = game.lairs.find(l => l.id === game.scenario.targetLairId);
      assert.ok(keep && keep.type === 'bandit' && keep.holding === game.otherHoldings[0]);
      assert.equal(keep.holding.coin, 0);
      assert.equal(keep.holding.relation, 'hostile');
      assert.equal(keep.holding.castleTier, 0);
      assert.equal(keep.holding.building, null);
      assert.ok(snapshot.scenarioProgress.clue);
      assert.equal(snapshot.scenarioProgress.target, undefined);
      const distance = Math.abs(keep.x - game.castle.x) + Math.abs(keep.y - game.castle.y);
      assert.ok(distance >= 24 && distance <= 44);
      assert.ok(['FOREST', 'DEEPWOOD'].includes(api._map().tiles[keep.y][keep.x]));
    }
    if (scenario === 'trade') {
      const n = game.neighbors[0];
      assert.ok(n && n.holding === game.otherHoldings[0]);
      assert.equal(n.holding.coin, 45);
      assert.equal(n.holding.food, 0);
      assert.equal(n.holding.relation, 'peaceful');
      assert.ok(snapshot.scenarioProgress.clue);
      assert.equal(api._map().tiles[n.y][n.x], 'TOWN');
      assert.equal(game.caches.component[n.y * api._map().tiles[0].length + n.x],
        game.caches.component[game.castle.y * api._map().tiles[0].length + game.castle.x]);
    }
    if (scenario === 'charter') {
      assert.equal(snapshot.coin, 70);
      assert.ok(snapshot.built.includes('rangers'));
      assert.ok(game.richSites.some(type => type !== 0));
    }
    if (scenario === 'convoy') {
      assert.equal(snapshot.coin, 70);
      assert.equal(snapshot.food, 25);
      assert.equal(snapshot.villagesAlive, 1);
      assert.equal(game.villages[0].id, game.scenario.targetVillageId);
    }
    if (scenario === 'marches') {
      assert.equal(snapshot.castleTier, 1);
      assert.equal(snapshot.guards, 2);
      assert.ok(game.scenario.clue);
      assert.ok(game.lairs.some(l => l.id === game.scenario.targetLairId && l.active && l.spawnTimer === 9));
    }
  }
}

function foundVillage(spec, preferred = null) {
  const game = api._goalProbeGame();
  const tiles = api._map().tiles;
  game.discovered.fill(1);
  game.coin = 1000;
  game.food = 1000;
  if (preferred) {
    const info = api.manualCanFoundVillage(preferred.x, preferred.y, spec);
    assert.equal(info.ok, true, info.reason);
    return api.manualFoundVillage(preferred.x, preferred.y, spec).village;
  }
  for (let radius = 6; radius <= 16; radius++) {
    for (let dy = -radius; dy <= radius; dy++) for (let dx = -radius; dx <= radius; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) continue;
      const x = game.castle.x + dx, y = game.castle.y + dy;
      if (x < 0 || y < 0 || x >= tiles[0].length || y >= tiles.length) continue;
      const info = api.manualCanFoundVillage(x, y, spec);
      if (info && info.ok) return api.manualFoundVillage(x, y, spec).village;
    }
  }
  throw new Error(`No ${spec} village site near the keep`);
}

function deliver(village, food, coin) {
  const game = api._goalProbeGame();
  const cart = {
    id: `test-cart-${game.villageStats.cartsDelivered}`,
    cart: true, alive: true, delivered: false, villageId: village.id,
    x: game.castle.x, y: game.castle.y, foodPayload: food, coinPayload: coin, deliveryId: 'castle',
    goal: { type: 'trade', target: { x: game.castle.x, y: game.castle.y } },
  };
  game.actors.push(cart);
  api._goalProbeArrival(cart);
  assert.equal(cart.delivered, true);
}

api.newGame(587033999, { scenario: 'winter', manual: true });
let game = api._goalProbeGame();
const foodVillage = foundVillage('fish');
deliver(foodVillage, 10, 0);
deliver(foodVillage, 10, 0);
assert.equal(game.scenario.foodCarts, 2);
game.seasonCount = 2;
assert.equal(api.stepTurn().snapshot.outcome, 'victory');

api.newGame(587033999, { scenario: 'charter', manual: true });
game = api._goalProbeGame();
game.food = 1000;
game.seasonCount = 3;
game.seasonEnds = 999;
assert.equal(api.stepTurn().snapshot.gameOverReason, 'charter');
assert.equal(api.stepTurn(), null);

api.newGame(587033999, { scenario: 'ore', manual: true });
game = api._goalProbeGame();
const cell = game.scenario.targetCell;
const cols = api._map().tiles[0].length;
const mine = foundVillage('mine', { x: cell % cols, y: (cell / cols) | 0 });
deliver(mine, 0, 5);
assert.equal(game.scenario.oreCarts, 1);
assert.equal(api.stepTurn().snapshot.outcome, 'victory');

api.newGame(587033999, { scenario: 'ore', manual: true });
game = api._goalProbeGame();
game.discovered.fill(1);
game.coin = 1000;
game.food = 1000;
const veins = [];
for (let i = 0; i < game.richSites.length; i++) if (game.richSites[i] === 3) veins.push({ x: i % cols, y: (i / cols) | 0 });
assert.ok(veins.length >= 2);
const lead = { x: game.scenario.targetCell % cols, y: (game.scenario.targetCell / cols) | 0 };
const alternate = veins.find(v => v.x !== lead.x || v.y !== lead.y);
assert.ok(Math.max(Math.abs(lead.x - alternate.x), Math.abs(lead.y - alternate.y)) >= 12);
let blocker = null;
for (let dy = -5; dy <= 5 && !blocker; dy++) for (let dx = -5; dx <= 5 && !blocker; dx++) {
  if (!dx && !dy) continue;
  const x = lead.x + dx, y = lead.y + dy;
  if (x < 0 || y < 0 || x >= cols || y >= api._map().tiles.length) continue;
  for (const spec of ['fields', 'forest', 'fish']) {
    if (api.manualCanFoundVillage(x, y, spec).ok) { blocker = { x, y, spec }; break; }
  }
}
assert.ok(blocker);
assert.equal(api.manualFoundVillage(blocker.x, blocker.y, blocker.spec).ok, true);
assert.equal(api.manualCanFoundVillage(lead.x, lead.y, 'mine').reason, 'too close to a village');
assert.equal(api.manualCanFoundVillage(alternate.x, alternate.y, 'mine').ok, true);
const secondMine = api.manualFoundVillage(alternate.x, alternate.y, 'mine').village;
deliver(secondMine, 0, 5);
assert.equal(api.stepTurn().snapshot.outcome, 'victory');

api.newGame(587033999, { scenario: 'crypt', manual: true });
game = api._goalProbeGame();
game.lairs.find(l => l.id === game.scenario.targetLairId).destroyed = true;
assert.equal(api.stepTurn().snapshot.outcome, 'victory');

api.newGame(587033999, { scenario: 'bandits', manual: true });
game = api._goalProbeGame();
const keep = game.lairs.find(l => l.id === game.scenario.targetLairId);
keep.holding.coin = 45;
api.stepTurn();
assert.equal(keep.holding.coin, 5, 'the bandit treasury earns income and pays for recruitment');
assert.equal(keep.holding.castleTier, 0);
const hiredBandit = game.hostiles.find(h => h.alive && h.ownerId === keep.ownerId && h.lairId === keep.id);
assert.ok(hiredBandit);
assert.equal(api._isHostileToPlayer(hiredBandit), true);
keep.holding.relation = 'peaceful';
assert.equal(api._isHostileToPlayer(hiredBandit), false);
keep.holding.relation = 'hostile';
const hires = keep.holding.recruitSeq;
keep.destroyed = true;
assert.equal(api.stepTurn().snapshot.outcome, 'victory');
assert.equal(keep.holding.recruitSeq, hires, 'destroyed keep cannot recruit');

// A known keep with a funded bounty can be destroyed by ordinary hero goals
// and combat, not just by setting the scenario flag directly.
api.newGame(587033999, { scenario: 'bandits', manual: true });
game = api._goalProbeGame();
const siegeKeep = game.lairs.find(l => l.id === game.scenario.targetLairId);
game.discovered.fill(1);
game.coin = 3000;
game.food = 10000;
game.population = 20;
game.built.push('monsters', 'rangers');
for (let i = 0; i < 3; i++) assert.equal(api.manualHire('monster'), true);
for (let i = 0; i < 2; i++) assert.equal(api.manualHire('ranger'), true);
for (const hero of game.actors) if (hero.role === 'monster') hero.level = 3;
api.postBounty('lair', siegeKeep.id, 8);
for (let i = 0; i < 30 && !game.gameOver; i++) api.stepTurn();
assert.equal(game.outcome, 'victory');
assert.equal(siegeKeep.destroyed, true);

api.newGame(587033999, { scenario: 'trade', manual: true });
game = api._goalProbeGame();
const neighbor = game.neighbors[0];
assert.equal(api.manualSellFood().reason, 'Find the hamlet first');
game.discovered[neighbor.y * cols + neighbor.x] = 1;
assert.deepEqual({ ...api.snapshot().scenarioProgress.target }, { x: neighbor.x, y: neighbor.y });
const routeCell = neighbor.y * cols + neighbor.x;
const routeComponent = game.caches.component[routeCell];
game.caches.component[routeCell] = 0;
assert.equal(api.manualSellFood().reason, 'No land route');
game.caches.component[routeCell] = routeComponent;
neighbor.holding.relation = 'hostile';
assert.equal(api.manualSellFood().reason, 'No trade agreement');
neighbor.holding.relation = 'peaceful';
game.food = 9;
assert.equal(api.manualSellFood().reason, 'Need 10 food');
game.food = 40;
neighbor.holding.coin = 14;
assert.equal(api.manualSellFood().reason, 'Hamlet cannot pay yet');
neighbor.holding.coin = 45;
neighbor.holding.food = 21;
assert.equal(api.manualSellFood().reason, 'Hamlet stores are full');
neighbor.holding.food = 0;
assert.equal(api.manualSellFood().ok, true);
assert.equal(game.coin, 135);
assert.equal(game.food, 30);
assert.equal(neighbor.holding.coin, 30);
assert.equal(neighbor.holding.food, 10);
assert.equal(api.manualSellFood().reason, 'One sale per turn');
foundVillage('fish');
api.stepTurn();
assert.equal(api.manualSellFood().ok, true);
api.stepTurn();
assert.equal(api.manualSellFood().ok, true);
assert.equal(game.neighborFoodSold, 30);
assert.equal(game.neighborCoinEarned, 45);
assert.equal(api.stepTurn().snapshot.outcome, 'victory');

api.newGame(587033999, { scenario: 'charter', manual: true });
game = api._goalProbeGame();
game.discovered.fill(1);
let richVillage = null;
for (let i = 0; i < game.richSites.length && !richVillage; i++) {
  const spec = ['fields', 'forest', 'mine', 'fish'][game.richSites[i] - 1];
  if (!spec) continue;
  const x = i % cols, y = (i / cols) | 0;
  if (api.manualCanFoundVillage(x, y, spec).ok) richVillage = foundVillage(spec, { x, y });
}
assert.ok(richVillage && richVillage.rich);
deliver(richVillage, 5, 5);
assert.equal(game.scenario.richCarts, 1);
game.seasonCount = 2;
assert.equal(api.stepTurn().snapshot.outcome, 'victory');

api.newGame(587033999, { scenario: 'convoy', manual: true });
game = api._goalProbeGame();
deliver(game.villages[0], 5, 0);
deliver(game.villages[0], 5, 0);
game.seasonCount = 2;
assert.equal(api.stepTurn().snapshot.outcome, 'victory');

api.newGame(587033999, { scenario: 'convoy', manual: true });
game = api._goalProbeGame();
game.villages[0].alive = false;
assert.equal(api.stepTurn().snapshot.gameOverReason, 'convoyLost');

api.newGame(587033999, { scenario: 'convoy', manual: true });
game = api._goalProbeGame();
game.seasonCount = 2;
game.seasonEnds = 999;
assert.equal(api.stepTurn().snapshot.gameOverReason, 'convoyLate');

api.newGame(587033999, { scenario: 'marches', manual: true });
game = api._goalProbeGame();
foundVillage('fish');
game.lairs.find(l => l.id === game.scenario.targetLairId).destroyed = true;
assert.equal(api.stepTurn().snapshot.outcome, 'victory');

api.newGame(587033999, { manual: true });
assert.equal(api.snapshot().scenarioId, 'freeplay');
assert.equal(api.stepTurn().snapshot.outcome, null);

console.log(`Scenario smoke checks passed (${seeds.length} seeds and all victory paths).`);
