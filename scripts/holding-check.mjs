#!/usr/bin/env node
import assert from 'node:assert/strict';
import { loadSimulationApi } from './sim-runtime.mjs';

const api = loadSimulationApi();
api.newGame(2222, { manual: true });
const player = api._goalProbeGame();
const playerCoin = player.coin;
const playerFood = player.food;
const playerActors = player.actors.length;
assert.equal(player.id, 'player');
assert.ok(player.actors.every(actor => actor.ownerId === player.id));

const bandits = api._makeHolding('bandits', { x: player.castle.x + 8, y: player.castle.y }, {
  coin: 300, food: 100, population: 4, built: ['rogues'],
});
const banditPolicy = { upgrade: false, build: [], heroes: { rogue: 2 }, earlyHero: true };
api._runKeepSteward(bandits, banditPolicy);
api._runKeepSteward(bandits, banditPolicy);
assert.equal(bandits.castleTier, 0, 'a bandit policy forbids upgrades');
assert.equal(bandits.building, null, 'a bandit policy forbids construction');
assert.equal(bandits.coin, 230, 'hiring spends the bandit treasury');
assert.equal(bandits.actors.length, 2);
assert.ok(bandits.actors.every(actor => actor.ownerId === 'bandits'
  && actor.x === bandits.castle.x && actor.y === bandits.castle.y));
assert.equal(bandits.actors.map(actor => actor.heroUid).join(','), 'bandits:1,bandits:2');

const neighbor = api._makeHolding('neighbor', { x: player.castle.x - 8, y: player.castle.y }, {
  coin: 150, food: 100, population: 4,
});
api._runKeepSteward(neighbor, { upgrade: false, build: ['granary'], heroes: {} });
assert.equal(neighbor.coin, 90);
assert.equal(neighbor.building.id, 'granary');
api._tickHoldingConstruction(neighbor);
assert.equal(neighbor.building.remaining, 1);
api._tickHoldingConstruction(neighbor);
assert.equal(neighbor.built.join(','), 'granary');
assert.equal(neighbor.building, null);

const vassal = api._makeHolding('vassal', { x: player.castle.x, y: player.castle.y + 8 }, {
  coin: 150, food: 100, population: 4,
});
api._runKeepSteward(vassal, { build: [], heroes: {} });
assert.equal(vassal.castleTier, 1, 'an independent holding can upgrade');
assert.equal(vassal.coin, 100);
assert.equal(vassal.food, 40);

assert.equal(player.coin, playerCoin, 'other holdings never spend the player treasury');
assert.equal(player.food, playerFood, 'other holdings never spend the player larder');
assert.equal(player.actors.length, playerActors, 'other holding rosters remain separate');
assert.equal(player.castleTier, 0);
assert.equal(player.built.length, 0);

const convoyApi = loadSimulationApi();
convoyApi.newGame(2222, { manual: true, scenario: 'convoy' });
const convoy = convoyApi._goalProbeGame();
assert.equal(convoy.villages[0].ownerId, convoy.id);
convoyApi.runTurns(2);
assert.ok(convoy.actors.some(actor => actor.cart && actor.ownerId === convoy.id),
  'village carts inherit their settlement owner');
assert.ok(convoy.actors.every(actor => actor.ownerId === convoy.id));

console.log('Independent holding treasury, construction, recruitment and upgrade checks passed.');
