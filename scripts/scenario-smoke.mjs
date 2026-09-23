#!/usr/bin/env node
import assert from 'node:assert/strict';
import { loadSimulationApi } from './sim-runtime.mjs';

const api = loadSimulationApi();
const seeds = [587033999, 1592594996, 25, 1151, 2222];

for (const seed of seeds) {
  for (const scenario of ['winter', 'ore', 'crypt']) {
    const snapshot = api.newGame(seed, { scenario, manual: true });
    const game = api._goalProbeGame();
    assert.equal(snapshot.scenarioId, scenario);
    assert.equal(snapshot.gameOver, false);
    assert.equal(snapshot.scenarioProgress.target, undefined);
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
assert.equal(api.stepTurn(), null);

api.newGame(587033999, { scenario: 'ore', manual: true });
game = api._goalProbeGame();
const cell = game.scenario.targetCell;
const cols = api._map().tiles[0].length;
const mine = foundVillage('mine', { x: cell % cols, y: (cell / cols) | 0 });
deliver(mine, 0, 5);
assert.equal(game.scenario.oreCarts, 1);
assert.equal(api.stepTurn().snapshot.outcome, 'victory');

api.newGame(587033999, { scenario: 'crypt', manual: true });
game = api._goalProbeGame();
game.lairs.find(l => l.id === game.scenario.targetLairId).destroyed = true;
assert.equal(api.stepTurn().snapshot.outcome, 'victory');

api.newGame(587033999, { manual: true });
assert.equal(api.snapshot().scenarioId, 'freeplay');
assert.equal(api.stepTurn().snapshot.outcome, null);

console.log(`Scenario smoke checks passed (${seeds.length} seeds and all victory paths).`);
