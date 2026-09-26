#!/usr/bin/env node
import assert from 'node:assert/strict';
import { loadSimulationApi } from './sim-runtime.mjs';

const api = loadSimulationApi();
api.newGame(2222, { manual: true });
const game = api._goalProbeGame();
const map = api._map();
game.built.push('rangers', 'rogues', 'fighters', 'monsters', 'monks');
game.coin = 10000;
const heroes = {};
for (const role of ['ranger', 'rogue', 'fighter', 'monster', 'monk']) {
  assert.equal(api.manualHire(role), true);
  heroes[role] = game.actors.find(a => a.hero && a.role === role);
  heroes[role].level = 2;
  heroes[role].maxHp += heroes[role].hdStep + Math.floor((heroes[role].con - 10) / 2);
  heroes[role].hp = heroes[role].maxHp;
}

const site = game.lairs[0];
assert.ok(site);
site.type = 'undead';
site.active = true;
site.destroyed = false;
site.x = game.castle.x + 3;
site.y = game.castle.y;
game.lairs.length = 1;
game.discovered.fill(1);
game.visible.fill(1);
game.caches.frontierMark.fill(0);
for (const cell of game.caches.ruins) game.exploredRuins.add(cell);
for (const hostile of game.hostiles) hostile.alive = false;

function decide(role) {
  const hero = heroes[role];
  hero.x = game.castle.x;
  hero.y = game.castle.y;
  hero.goal = null;
  return api._goalProbeChoose(hero);
}

for (const role of ['fighter', 'monster'])
  assert.equal(decide(role)?.type, 'assault', `${role} can assault a known lair at level two`);
for (const role of ['ranger', 'rogue'])
  assert.notEqual(decide(role)?.type, 'assault', `${role} waits for a better offer`);
assert.ok(api.manualBounty('lair', site.id));
for (const role of ['ranger', 'rogue'])
  assert.equal(decide(role)?.type, 'assault', `${role} considers a paid lair at level two`);
const paidRangerGoal = heroes.ranger.goal;
game.turn++;
assert.equal(api._goalProbeChoose(heroes.ranger), paidRangerGoal,
  'a valid paid assault stays committed on the next turn');

// The hunter favours a nearby winnable foe until a full lair bounty outweighs
// that errand. A scout still prefers a paid exploration flag, and a rogue a
// safe village to extort.
const fodder = game.hostiles.find(h => h.kind === 'goblin');
fodder.alive = true;
fodder.x = game.castle.x - 2;
fodder.y = game.castle.y;
fodder.hp = 1;
assert.equal(api._goalProbeCandidates(heroes.monster)[0]?.type, 'engage');
for (let i = 0; i < 5; i++) api.manualBounty('lair', site.id);
assert.equal(api._goalProbeCandidates(heroes.monster)[0]?.type, 'assault',
  'reward can outweigh an ordinary hunt');
fodder.alive = false;
assert.ok(api.manualBounty('explore', { x: game.castle.x + 1, y: game.castle.y }));
assert.equal(api._goalProbeCandidates(heroes.ranger)[0]?.type, 'explore',
  'rangers keep their scouting preference');
game.bounties.pop();
game.villages.push({ id: 'safe-village', name: 'Safe Village', alive: true,
  x: game.castle.x + 1, y: game.castle.y, extortCooldown: 0 });
assert.equal(decide('rogue')?.type, 'extort', 'rogues prefer a safe earning opportunity');

// A monk with no companion can join an assault after gaining enough strength.
assert.equal(decide('monk')?.type, 'support', 'a monk with allies supports them first');
for (const role of ['ranger', 'rogue', 'fighter', 'monster']) heroes[role].alive = false;
const monk = heroes.monk;
monk.hp = monk.maxHp = 30;
monk.atk = 8;
monk.dmg = { n: 1, d: 8, mod: 4 };
assert.equal(decide('monk')?.type, 'assault');

// A nearby garrison can outweigh the site's loot and even a posted bounty.
const guarded = game.hostiles[0];
guarded.alive = true;
guarded.x = site.x;
guarded.y = site.y + 1;
guarded.hp = 100;
guarded.atk = 15;
guarded.dmg = { n: 2, d: 10, mod: 8 };
assert.notEqual(api._goalProbeChoose(monk)?.type, 'assault',
  'a new strong defender cancels an incumbent assault despite the bounty');

// Health and level gates are independent of the reward.
guarded.alive = false;
monk.hp = monk.maxHp * 0.5;
assert.notEqual(decide('monk')?.type, 'assault', 'a wounded hero rests instead');
monk.hp = monk.maxHp;
monk.level = 1;
monk.atk = 1;
monk.dmg = { n: 1, d: 4, mod: 0 };
assert.notEqual(decide('monk')?.type, 'assault', 'a weak level-one hero is not eligible');

console.log('Level-two lair eligibility and class risk/reward choices passed.');
