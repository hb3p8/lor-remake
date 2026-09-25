#!/usr/bin/env node
import assert from 'node:assert/strict';
import { loadSimulationApi } from './sim-runtime.mjs';

const api = loadSimulationApi();
api.newGame(2222, { manual: true });
const game = api._goalProbeGame();
game.population = 4;
assert.equal(api._stewardCanUpgrade(1000), false,
  'a stockpile cannot substitute for a working food route');

const village = {
  id: 'food-route', alive: true, foodRate: 7, winterFoodRate: 0,
  lastFoodDeliveryTurn: -999,
};
game.villages.push(village);
assert.equal(api._stewardCanUpgrade(1000), false,
  'an unproven village route cannot support an upgrade');

village.lastFoodDeliveryTurn = game.turn;
const currentReserve = api._stewardFoodReserve(game.population);
const growthReserve = api._stewardFoodReserve(game.population + 2);
assert.ok(growthReserve > currentReserve,
  'the new housing capacity must raise the forecast food need');
assert.equal(api._stewardCanUpgrade(currentReserve), false,
  'food sufficient for the current population is not enough after expansion');
assert.equal(api._stewardCanUpgrade(growthReserve), true);

game.turn += 13;
assert.equal(api._stewardCanUpgrade(1000), false,
  'a food route with no recent delivery is no longer trusted');
village.lastFoodDeliveryTurn = game.turn;
village.alive = false;
assert.equal(api._stewardCanUpgrade(1000), false,
  'a destroyed village cannot support an upgrade');

const convoyApi = loadSimulationApi();
convoyApi.newGame(2222, { scenario: 'convoy', manual: true });
const convoy = convoyApi._goalProbeGame();
assert.equal(convoy.villages[0].lastFoodDeliveryTurn, -999);
convoyApi.runTurns(3);
assert.ok(convoy.villages[0].lastFoodDeliveryTurn >= 0,
  'a real food cart marks its origin as a working route');

console.log('Steward upgrade food route, delivery freshness and growth reserve checks passed.');
