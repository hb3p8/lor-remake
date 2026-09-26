#!/usr/bin/env node
import assert from 'node:assert/strict';
import { loadSimulationApi } from './sim-runtime.mjs';

const context = loadSimulationApi({ context: true, viewportWidth: 390, viewportHeight: 844 });
const api = context.window.__lorTest;
const d = context.window.__lorDebug;
api.newGame(2222, { manual: true, render: true });
const game = d.game;
game.coin = 1000;

for (const id of ['market', 'port', 'fighters', 'monks', 'monsters'])
  assert.equal(api.manualBuild(id), false, `${id} is locked at Timber Hall`);
api.selectCity();
let rows = api.menuRows();
assert(rows.some(row => row.includes('Granary')));
assert(rows.some(row => row.includes('Next Wooden Palisade')));
assert(!rows.some(row => row.includes('[ ] Market')));

game.castleTier = 1;
assert.equal(api.manualBuild('monsters'), false, "Hunters' Hall needs Motte & Bailey");
assert.equal(api.manualBuild('market'), true);
game.building = null;
game.built.push('market');
assert.equal(api.manualBuild('fighters'), true);
game.building = null;
api.selectCity();
rows = api.menuRows();
assert(rows.some(row => row.includes('Market potions: 8HP 5c')));
assert(rows.some(row => row.includes('Next Motte & Bailey')));
assert(!rows.some(row => row.includes("[ ] Hunters' Hall")));

const holding = api._makeHolding('tier-check', { x: game.castle.x + 8, y: game.castle.y }, {
  coin: 1000, food: 0, population: 4,
});
api._runKeepSteward(holding, { upgrade: false, build: ['fighters'], heroes: {} });
assert.equal(holding.building, null, 'Steward respects the same tier gate');
holding.castleTier = 1;
api._runKeepSteward(holding, { upgrade: false, build: ['fighters'], heroes: {} });
assert.equal(holding.building.id, 'fighters');

api.newGame(2222, { manual: true, scenario: 'convoy' });
const villageGame = d.game;
const village = villageGame.villages[0];
villageGame.coin = 1000;
assert.equal(api._buildVillage(village.id, 'guardhouse'), false);
villageGame.castleTier = 2;
assert.equal(api._buildVillage(village.id, 'guardhouse'), true);

api.newGame(2222, { manual: true });
const potionGame = d.game;
potionGame.built.push('market', 'rangers');
potionGame.coin = 0;
assert.equal(api.manualHire('ranger'), false);
potionGame.coin = 1000;
assert.equal(api.manualHire('ranger'), true);
const hero = potionGame.actors.find(actor => actor.hero && actor.role === 'ranger');
hero.maxHp = 30;
hero.hp = 30;
hero.potions = 0;
hero.purse = 60;
d.heroShop(hero, []);
assert.equal(hero.largePotions, 0, 'large potions are absent before Motte & Bailey');
assert.equal(hero.potions, 3);
assert.equal(hero.purse, 45);

potionGame.castleTier = 2;
hero.potions = 0;
hero.purse = 60;
const spentBefore = potionGame.heroShopSpent;
d.heroShop(hero, []);
assert.equal(hero.largePotions, 1);
assert.equal(hero.potions, 2);
assert.equal(hero.purse, 20);
assert.equal(potionGame.heroShopSpent - spentBefore, 40, 'the large flask costs 30, small flasks 5 each');
assert.equal(potionGame.simStats.largePotionsBought, 1);

hero.hp = 20;
const battleLog = [];
assert.equal(d.maybeQuaffPotion(hero, battleLog), true);
assert.equal(hero.hp, 30, 'large potion restores up to 20 HP');
assert.equal(hero.largePotions, 0);
assert.match(battleLog[0].t, /large potion/);
assert.equal(potionGame.simStats.largePotionsQuaffed, 1);
hero.hp = 10;
assert.equal(d.maybeQuaffPotion(hero, []), true);
assert.equal(hero.hp, 18, 'ordinary potion restores 8 HP');
assert.equal(hero.potions, 1);
hero.largePotions = 1;
hero.maxHp = 20;
hero.hp = 13;
assert.equal(d.maybeQuaffPotion(hero, []), true);
assert.equal(hero.hp, 20, 'a small potion is used when it can cover the wound');
assert.equal(hero.largePotions, 1);

console.log('Castle tier, mobile menu, village gate, and potion checks passed.');
