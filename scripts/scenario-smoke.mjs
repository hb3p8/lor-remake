#!/usr/bin/env node
import assert from 'node:assert/strict';
import { loadSimulationApi } from './sim-runtime.mjs';

const api = loadSimulationApi();
const seeds = [587033999, 1592594996, 25, 1151, 2222];

for (const seed of seeds) {
  for (const scenario of ['charter', 'convoy', 'marches', 'winter', 'ore', 'crypt']) {
    const snapshot = api.newGame(seed, { scenario, manual: true });
    const game = api._goalProbeGame();
    assert.equal(snapshot.scenarioId, scenario);
    assert.equal(snapshot.gameOver, false);
    if (scenario !== 'convoy') assert.equal(snapshot.scenarioProgress.target, undefined);
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
    x: game.castle.x, y: game.castle.y, foodPayload: food, coinPayload: coin,
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
