#!/usr/bin/env node
import assert from 'node:assert/strict';
import { loadSimulationApi } from './sim-runtime.mjs';

const api = loadSimulationApi({ viewportWidth: 390, viewportHeight: 844 });
api.newGame(587033999, { scenario: 'trade', manual: true, render: true });
const game = api._goalProbeGame();
const neighbor = game.neighbors[0];
const cols = api._map().tiles[0].length;
game.discovered[neighbor.y * cols + neighbor.x] = 1;

const menu = api.menuState();
let cell = null;
for (let y = 0; y < menu.viewRows && !cell; y++) for (let x = 0; x < menu.viewCols; x++) {
  const world = api.worldCellAt(x, y);
  if (world && world.x === neighbor.x && world.y === neighbor.y) { cell = { x, y }; break; }
}
assert.ok(cell, 'the nearby hamlet fits on the 390×844 map view');
assert.equal(api.worldTap(cell.x, cell.y), 'neighbor');
let rows = api.menuRows();
assert.ok(rows.some(row => row.includes('PEACEFUL NEIGHBOR')));
const sellRow = rows.findIndex(row => row.includes('[ SELL 10 FOOD'));
assert.ok(sellRow > 0);
api.menuTap(1, sellRow);
rows = api.menuRows();
assert.ok(rows.some(row => row.includes('SOLD 10 FOOD')));
assert.equal(game.neighborFoodSold, 10);
api.menuTap(1, sellRow);
assert.equal(game.neighborFoodSold, 10, 'a second tap cannot sell twice in one turn');
api.menuTap(1, 0);
assert.equal(api.menuState().viewMode, 'world');

console.log('Neighbor trade screen and one-tap sale passed at 390×844.');
