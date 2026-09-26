#!/usr/bin/env node
import assert from 'node:assert/strict';
import { loadSimulationApi } from './sim-runtime.mjs';

const api = loadSimulationApi({ viewportWidth: 390, viewportHeight: 844 });

function screenCell(x, y) {
  const { viewCols, viewRows } = api.menuState();
  for (let row = 0; row < viewRows; row++) for (let col = 0; col < viewCols; col++) {
    const tile = api.worldCellAt(col, row);
    if (tile && tile.x === x && tile.y === y) return { col, row };
  }
  throw new Error(`Tile ${x},${y} is off screen`);
}
function choiceRow(label) {
  const row = api.menuRows().findIndex(text => text.includes(`› ${label}`));
  assert(row >= 0, `Missing choice ${label}`);
  return row;
}

api.newGame(2222, { manual: true, render: true });
let game = api._goalProbeGame();
game.built.push('rangers');
game.coin = 1000;
assert(api.manualHire('ranger'));
assert(api.manualHire('ranger'));
const heroes = game.actors.filter(actor => actor.hero);
const castle = screenCell(game.castle.x, game.castle.y);
assert.equal(api.worldTap(castle.col, castle.row, 'touch'), 'targets');
let rows = api.menuRows();
assert(rows.some(row => row.includes('CASTLE · Aldermere')));
assert(rows.some(row => row.includes(`HERO · ${heroes[0].name}`)));
assert(rows.some(row => row.includes(`HERO · ${heroes[1].name}`)));
assert(rows.some(row => row.includes('GUARD ·')));

api.menuTap(2, choiceRow('CASTLE'));
assert.equal(api.menuState().viewMode, 'city');
assert(api.menuRows()[0].includes('BACK TO TARGETS'));
api.menuTap(2, 0);
assert.equal(api.menuState().viewMode, 'targets');
api.menuTap(2, choiceRow(`HERO · ${heroes[1].name}`));
assert.equal(api.menuState().viewMode, 'actor');
assert(api.menuRows().some(row => row.includes(heroes[1].name)));
api.menuTap(2, 0);
assert.equal(api.menuState().viewMode, 'targets');
api.menuTap(2, 0);
assert.equal(api.menuState().viewMode, 'world');
game.actors.length = 0;
assert.equal(api.worldTap(castle.col, castle.row, 'touch'), 'city', 'a lone castle opens directly');
api.menuTap(2, 0);

api.newGame(2222, { manual: true, render: true, scenario: 'convoy' });
game = api._goalProbeGame();
game.built.push('rangers');
game.coin = 1000;
assert(api.manualHire('ranger'));
const hero = game.actors.find(actor => actor.hero);
const village = game.villages[0];
hero.x = village.x; hero.y = village.y;
const villageCell = screenCell(village.x, village.y);
assert.equal(api.worldTap(villageCell.col, villageCell.row, 'touch'), 'targets');
api.menuTap(2, choiceRow('VILLAGE'));
assert.equal(api.menuState().viewMode, 'village');
api.menuTap(2, 0);
assert.equal(api.menuState().viewMode, 'targets');
api.menuTap(2, choiceRow(`HERO · ${hero.name}`));
assert.equal(api.menuState().viewMode, 'actor');
api.menuTap(2, 0);
api.menuTap(2, 0);

const map = api._map();
const { viewCols, viewRows } = api.menuState();
let loneCell = null;
for (let row = 0; row < viewRows && !loneCell; row++) for (let col = 0; col < viewCols; col++) {
  const tile = api.worldCellAt(col, row);
  if (!tile) continue;
  const i = tile.y * map.tiles[0].length + tile.x;
  if (!game.visible[i] || !game.discovered[i] || !['PLAINS', 'GRASS', 'ROAD'].includes(map.tiles[tile.y][tile.x])) continue;
  if (game.actors.some(actor => actor.alive && actor.x === tile.x && actor.y === tile.y)) continue;
  if (game.hostiles.some(hostile => hostile.alive && hostile.x === tile.x && hostile.y === tile.y)) continue;
  if (game.villages.some(v => v.alive && v.x === tile.x && v.y === tile.y)) continue;
  loneCell = { ...tile, col, row };
}
assert(loneCell);
hero.x = loneCell.x; hero.y = loneCell.y;
assert.equal(api.worldTap(loneCell.col, loneCell.row, 'touch'), 'actor', 'a lone hero opens directly');
api.menuTap(2, 0);
assert(api.manualHire('ranger'));
const secondHero = game.actors.find(actor => actor.hero && actor !== hero);
secondHero.x = loneCell.x; secondHero.y = loneCell.y;
assert.equal(api.worldTap(loneCell.col, loneCell.row, 'touch'), 'targets', 'two heroes on open ground need a choice');
assert(api.menuRows().some(row => row.includes(`HERO · ${secondHero.name}`)));
api.menuTap(2, 0);

hero.x = secondHero.x = game.castle.x;
hero.y = secondHero.y = game.castle.y;
for (let i = 0; i < 22; i++)
  game.actors.push({ ...hero, id: `crowd-${i}`, name: `Crowd ${i}` });
const crowdedCastle = screenCell(game.castle.x, game.castle.y);
assert.equal(api.worldTap(crowdedCastle.col, crowdedCastle.row, 'touch'), 'targets');
assert(api.menuRows().some(row => row.includes('page 1/2')));
const { cols, rows: panelRows } = api.menuState();
api.menuTap(cols - 2, panelRows - 2);
assert(api.menuRows().some(row => row.includes('page 2/2')));
assert(api.menuRows().some(row => row.includes('Crowd 21')));

console.log('Target chooser covers stacked settlements and heroes, Back navigation, lone units, and paging.');
