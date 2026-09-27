#!/usr/bin/env node
import assert from 'node:assert/strict';
import { loadSimulationApi } from './sim-runtime.mjs';

const api = loadSimulationApi();
api.newGame(2222, { manual: true, render: false });
const game = api._goalProbeGame();

assert.equal(api._tameTest('bear').tamed, true);
const ranger = game.actors.find(a => a.alive && a.role === 'ranger');
const bear = game.actors.find(a => a.alive && a.tamed);
assert.equal(ranger.level, 3, 'bear taming unlocks at ranger level three');
assert.equal(bear.maxHp, 41, 'bear HP uses the 2.3 multiplier');

// A kill by the beast should pay its living ranger exactly as a direct kill
// would, without transferring the beast's own kill XP.
const wildGoldBefore = game.wildGold;
const purseBefore = ranger.purse;
const xpBefore = ranger.xp;
const beastXpBefore = bear.xp;
const target = game.hostiles.find(h => !h.alive && h.kind === 'bear');
Object.assign(target, {
  id: 'pet-kill-target', name: 'Bandit', kind: 'bandit', alive: true,
  x: bear.x + 1, y: bear.y, hp: 1, maxHp: 1, ac: -100, atk: -100,
  dmg: { n: 1, d: 1, mod: 0 }, threat: 1,
});
bear.atk = 100;
bear.dmg = { n: 1, d: 1, mod: 10 };
api._resolveActorMelee(bear, target);
assert.equal(target.alive, false);
assert.equal(ranger.purse - purseBefore, 13, 'bandit loot goes to the ranger');
assert.equal(game.wildGold - wildGoldBefore, 13);
assert.equal(ranger.xp, xpBefore, 'pet kills do not grant ranger XP');
assert.ok(bear.xp > beastXpBefore, 'pet retains its kill XP');

// Posted bounties belong to the ranger too, including food from a hunt.
Object.assign(target, { id: 'pet-hunt-target', name: 'Boar', kind: 'boar', alive: true, hp: 1 });
game.bounties.push({ id: 991, type: 'hunt', hostileId: target.id, reward: 20 });
const foodBefore = game.food;
const bountyBefore = game.heroBountyPaid;
const purseBeforeHunt = ranger.purse;
api._resolveActorMelee(bear, target);
assert.equal(ranger.purse - purseBeforeHunt, 25, 'hunt bounty and boar loot both reach ranger');
assert.equal(game.food - foodBefore, 25, 'pet can fulfill hunt food delivery');
assert.equal(game.heroBountyPaid - bountyBefore, 20);
assert.equal(game.bounties.length, 0);

Object.assign(target, { id: 'pet-bounty-target', name: 'Bandit', kind: 'bandit', alive: true, hp: 1 });
game.bounties.push({ id: 992, type: 'kill', hostileId: target.id, reward: 30 });
const purseBeforeBounty = ranger.purse;
api._resolveActorMelee(bear, target);
assert.equal(ranger.purse - purseBeforeBounty, 43, 'kill bounty and bandit loot both reach ranger');
assert.equal(game.bounties.length, 0);

// Restore normal beast damage, keep the test world peaceful, and advance one
// complete big turn: four sub-turns must produce only one regeneration tick.
bear.dmg = { n: 1, d: 1, mod: 0 };
bear.hp = 1;
bear.steps = 0;
for (const hostile of game.hostiles) hostile.alive = false;
const regen = Math.ceil(bear.maxHp * 0.12);
api.stepTurn();
assert.equal(bear.hp, 1 + regen, 'pet regenerates once per safe big turn');

console.log('Ranger companion HP, bear unlock, loot, bounty and regen checks passed.');
