#!/usr/bin/env node
import assert from 'node:assert/strict';
import { loadSimulationApi } from './sim-runtime.mjs';

const api = loadSimulationApi();
api.newGame(2222, { scenario: 'bandits', manual: true });
const game = api._goalProbeGame();
const keep = game.lairs.find(l => l.type === 'bandit');
assert.ok(keep);
assert.equal(keep.holding.coin, 0);

function hire() {
  keep.holding.coin = 45;
  api._runBanditKeep(keep);
  return game.hostiles.filter(h => h.alive && h.ownerId === keep.ownerId);
}

let hired = hire();
assert.equal(hired.length, 1);
assert.equal(hired[0].kind, 'bandit');
assert.equal(hired[0].mustering, true);
assert.equal(hired[0].raider, false);
hire();
assert.equal(game.hostiles.filter(h => h.alive && h.mustering && h.ownerId === keep.ownerId).length, 2);
hired = hire();
assert.equal(hired.length, 3);
assert.ok(hired.every(h => h.kind === 'bandit' && h.raider && !h.mustering), 'three bandits depart together');
hired = hire();
const rogue = hired.find(h => h.kind === 'banditRogue');
assert.ok(rogue && rogue.glyph === 'r' && rogue.fg === '#ff4747');
assert.equal(rogue.level, 1);
assert.equal(rogue.purse, 0);
assert.equal(hire().length, 4, 'the keep holds at one party and one rogue');

api._gainBanditRogueXp(rogue, 1000);
assert.equal(rogue.level, 3, 'rogue progression stops at level three');
assert.equal(rogue.xp, 0);
assert.equal(rogue.hp, rogue.maxHp);

// The rogue evaluates the same hero differently as its combat power changes.
const hero = {
  id: 'probe-hero', name: 'Probe', role: 'ranger', hero: true, alive: true,
  x: rogue.x + 1, y: rogue.y, hp: 2, maxHp: 2, atk: 1, ac: 10,
  dmg: { n: 1, d: 2, mod: 0 }, purse: 30, potions: 0,
};
game.actors.push(hero);
let candidates = api._banditRogueCandidates(rogue);
assert.equal(candidates[0]?.type, 'stalk', 'rogue pursues a weaker hero');
hero.hp = hero.maxHp = 100;
hero.atk = 15;
hero.dmg = { n: 2, d: 8, mod: 5 };
candidates = api._banditRogueCandidates(rogue);
assert.equal(candidates[0]?.type, 'flee', 'rogue retreats from a stronger hero');
assert.ok(rogue.stealthTurns > 0, 'close threat triggers stealth');

// A hidden enemy remains an actual map unit, but the player cannot pin or
// attack it until stealth ends. The combat probe checks theft on a fatal hit.
rogue.stealthTurns = 0;
rogue.hp = rogue.maxHp = 100;
rogue.atk = 100;
hero.hp = hero.maxHp = 1;
hero.atk = -100;
hero.purse = 30;
api._resolveActorMelee(hero, rogue);
assert.equal(hero.alive, false);
assert.equal(hero.purse, 0);
assert.equal(rogue.purse, 30);

// The same ordinary village raid removes stored food and coin. A rogue can
// join only when no defender is near, then carries the stolen coin home.
const village = {
  id: 'probe-village', name: 'Probe Village', x: rogue.x, y: rogue.y,
  alive: true, hp: 100, maxHp: 100, storedFood: 12, storedCoin: 31,
  raidsSurvived: 0, lastRaidTurn: -1,
};
game.villages.push(village);
api._resolveVillageRaids();
assert.equal(village.storedFood, 0);
assert.equal(village.storedCoin, 0);
assert.equal(rogue.purse, 61);

for (const h of hired) if (h.kind === 'bandit') h.alive = false;
hero.alive = true;
hero.x = village.x;
hero.y = village.y;
village.storedFood = 7;
village.storedCoin = 19;
api._resolveVillageRaids();
assert.equal(village.storedFood, 7, 'a defender prevents a rogue-only village raid');
assert.equal(village.storedCoin, 19);
hero.alive = false;

rogue.x = keep.x;
rogue.y = keep.y;
const before = keep.holding.coin;
api._depositBanditRogue(rogue);
assert.equal(rogue.purse, 0);
assert.equal(keep.holding.coin, before + 61);
keep.holding.coin = 200;
api._runBanditKeep(keep);
assert.equal(keep.holding.coin, 155, 'the normal income cap must not erase deposited loot');

// An adjacent guard would normally pin an enemy. The rogue must enter stealth
// before that lock is checked, then actually take a step away.
const escapeApi = loadSimulationApi();
escapeApi.newGame(2222, { scenario: 'bandits', manual: true });
const escapeGame = escapeApi._goalProbeGame();
const escapeKeep = escapeGame.lairs.find(l => l.type === 'bandit');
for (let i = 0; i < 4; i++) {
  escapeKeep.holding.coin = 45;
  escapeApi._runBanditKeep(escapeKeep);
}
const escapeRogue = escapeGame.hostiles.find(h => h.kind === 'banditRogue');
const guard = escapeGame.actors.find(a => a.role === 'guard');
const tiles = escapeApi._map().tiles;
let guardSpot = null;
for (let dy = -1; dy <= 1 && !guardSpot; dy++) for (let dx = -1; dx <= 1; dx++) {
  if (!dx && !dy) continue;
  const x = escapeRogue.x + dx, y = escapeRogue.y + dy;
  if (tiles[y]?.[x] && !['WATER', 'DEEP', 'PEAK', 'MOUNTAIN'].includes(tiles[y][x])) {
    guardSpot = { x, y };
    break;
  }
}
assert.ok(guardSpot);
guard.x = guardSpot.x;
guard.y = guardSpot.y;
guard.steps = 0;
guard.hp = guard.maxHp = 100;
escapeGame.actors = [guard];
escapeGame.hostiles = [escapeRogue];
const start = { x: escapeRogue.x, y: escapeRogue.y };
escapeApi._stepSubTurn();
assert.ok(escapeRogue.stealthTurns > 0);
assert.equal(escapeRogue.goal?.type, 'flee');
assert.notDeepEqual({ x: escapeRogue.x, y: escapeRogue.y }, start);

// Exercise the actual text-grid renderer without a browser. Even on the
// scenario target and during stealth, the castle/rogue glyphs stay visible.
const uiApi = loadSimulationApi();
uiApi.newGame(2222, { scenario: 'bandits', manual: true, render: true });
const uiGame = uiApi._goalProbeGame();
const uiKeep = uiGame.lairs.find(l => l.type === 'bandit');
uiGame.actors = [];
uiGame.hostiles = [];
uiGame.lairs = [uiKeep];
uiKeep.x = uiGame.castle.x + 3;
uiKeep.y = uiGame.castle.y;
uiGame.discovered.fill(1);
uiGame.visible.fill(1);
function renderedCell(x, y) {
  const { viewCols, viewRows } = uiApi.menuState();
  for (let row = 0; row < viewRows; row++) for (let col = 0; col < viewCols; col++) {
    const cell = uiApi.worldCellAt(col, row);
    if (cell?.x === x && cell?.y === y) {
      return { glyph: uiApi.worldGlyphAt(col, row), fg: uiApi.worldForegroundAt(col, row) };
    }
  }
  return null;
}
uiApi.setSeason('summer');
assert.deepEqual(renderedCell(uiKeep.x, uiKeep.y), { glyph: '♜', fg: '#f05252' });
const hiddenRogue = { ...rogue, x: uiGame.castle.x + 4, y: uiGame.castle.y, alive: true, stealthTurns: 4 };
uiGame.hostiles.push(hiddenRogue);
uiApi.setSeason('summer');
assert.deepEqual(renderedCell(hiddenRogue.x, hiddenRogue.y), { glyph: 'r', fg: '#b84a4a' });

console.log('Bandit party, rogue behavior, theft, village loot, keep deposit and map glyph checks passed.');
