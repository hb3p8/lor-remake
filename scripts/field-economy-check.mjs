import assert from 'node:assert/strict';
import { loadSimulationApi } from './sim-runtime.mjs';

const context = loadSimulationApi({ context: true });
const api = context.window.__lorTest;
const d = context.window.__lorDebug;

for (const mapType of ['balanced', 'forest-swamp', 'mountain', 'islands']) {
  for (const seed of [2222, 3509986198, 1592594996]) {
    api.newGame(seed, { manual: true, mapType });
    const { game, map } = d;
    let fields = 0;
    for (let y = Math.max(0, game.castle.y - 6); y <= Math.min(d.rows - 1, game.castle.y + 6); y++) {
      for (let x = Math.max(0, game.castle.x - 6); x <= Math.min(d.cols - 1, game.castle.x + 6); x++) {
        if (map.tiles[y][x] === 'FARM') fields++;
      }
    }
    assert.ok(fields <= 6, `${mapType}/${seed}: castle has ${fields} fields`);
    assert.equal(api.manualState().foodProduction, fields * 0.8);
  }
}

function foundFarmVillage(rich) {
  api.newGame(2222, { manual: true });
  const { game, map, cols, rows } = d;
  const cx = game.castle.x, cy = game.castle.y;
  const vx = cx + 8 < cols - 4 ? cx + 8 : cx - 8;
  assert.ok(cy + 4 < rows);
  for (let y = 0; y < rows; y++) map.tiles[y].fill('PLAINS');
  map.tiles[cy][cx] = 'CASTLE';
  map.tiles[cy + 4].fill('WATER');
  game.actors.length = 0;
  game.hostiles.length = 0;
  game.lairs.length = 0;
  game.neighbors.length = 0;
  game.villages.length = 0;
  game.richSites.fill(0);
  if (rich) game.richSites[cy * cols + vx] = 1;
  game.discovered.fill(1);
  game.discoveredTotal = cols * rows;
  game.coin = 1000;
  game.food = 1000;
  game.caches = d.makeWorldCaches(map, game.castle);
  game.pathScratch = d.makePathScratch();
  const preview = d.canFoundVillageAt(vx, cy, 'fields');
  assert.equal(preview.ok, true, JSON.stringify(preview));
  assert.equal(preview.fields, 15);
  assert.equal(preview.foodRate, rich ? 15 : 12);
  assert.equal(preview.coinRate, 0);
  const result = d.foundVillageAt(vx, cy, 'fields');
  assert.equal(result.ok, true, JSON.stringify(result));
  return result.village;
}

for (const rich of [false, true]) {
  const village = foundFarmVillage(rich);
  assert.equal(village.fieldCells.length, 15);
  assert.equal(village.foodRate, rich ? 15 : 12);
  assert.equal(village.coinRate, 0);
  village.cartTimer = 999;
  village.coinRate = 3; // old saves can still carry the former field income
  d.tickVillages([]);
  assert.equal(village.storedFood, rich ? 15 : 12);
  assert.equal(village.coinRate, 0);
  assert.equal(village.storedCoin, 0);
  // The yield follows the remaining visible field tiles, with one rounding
  // step for the whole village rather than one food per field.
  for (let i = 1; i < 11; i++) {
    const cell = village.fieldCells[i];
    d.map.tiles[(cell / d.cols) | 0][cell % d.cols] = 'PLAINS';
  }
  d.tickVillages([]);
  assert.equal(village.foodRate, rich ? 5 : 4);
  village.built.push('inn');
  d.tickVillages([]);
  assert.equal(village.storedCoin, 2, 'buildings still produce coin');
}

console.log('Castle and village field yields, cap, rich bonus, and building coin: OK');
