#!/usr/bin/env node
import assert from 'node:assert/strict';
import { loadSimulationApi } from './sim-runtime.mjs';

const context = loadSimulationApi({ context: true });
const api = context.window.__lorTest;
const debug = context.window.__lorDebug;
const seeds = [587033999, 1592594996, 25, 1151, 2222];
const sea = new Set(['WATER', 'DEEP']);

function islandComponents(tiles) {
  const labels = new Uint16Array(debug.cols * debug.rows);
  const sizes = [];
  const queue = new Int16Array(labels.length);
  for (let start = 0; start < labels.length; start++) {
    const sx = start % debug.cols, sy = (start / debug.cols) | 0;
    if (labels[start] || sea.has(tiles[sy][sx])) continue;
    let head = 0, tail = 0;
    const label = sizes.length + 1;
    labels[start] = label;
    queue[tail++] = start;
    while (head < tail) {
      const cell = queue[head++], x = cell % debug.cols, y = (cell / debug.cols) | 0;
      const adjacent = [cell - 1, cell + 1, cell - debug.cols, cell + debug.cols];
      for (const next of adjacent) {
        if (next < 0 || next >= labels.length || labels[next] ||
            Math.abs(next % debug.cols - x) + Math.abs(((next / debug.cols) | 0) - y) !== 1) continue;
        const nx = next % debug.cols, ny = (next / debug.cols) | 0;
        if (sea.has(tiles[ny][nx])) continue;
        labels[next] = label;
        queue[tail++] = next;
      }
    }
    sizes.push(tail);
  }
  return { sizes, labels };
}

for (const mapType of ['balanced', 'mountain', 'forest-swamp', 'islands']) {
  for (const seed of mapType === 'islands' ? [...seeds, 2027808452] : seeds) {
    const snapshot = api.newGame(seed, { mapType, manual: true });
    const { map, game } = debug;
    const counts = Object.create(null);
    for (const row of map.tiles) for (const tile of row) counts[tile] = (counts[tile] || 0) + 1;
    assert.equal(snapshot.mapType, mapType);
    assert.equal(snapshot.seed, seed);
    assert.ok(counts.CASTLE === 1 && counts.FARM >= 8, `${mapType} ${seed}: viable start`);
    if (mapType === 'mountain') {
      assert.ok((counts.MOUNTAIN || 0) + (counts.PEAK || 0) > 2400, `${seed}: highlands dominate`);
      assert.ok((counts.RIVER || 0) > 250, `${seed}: river valleys`);
      assert.ok((counts.FOREST || 0) < 500 && (counts.WATER || 0) < 300, `${seed}: sparse woods and lakes`);
    } else if (mapType === 'forest-swamp') {
      assert.equal(counts.MOUNTAIN || 0, 0);
      assert.ok((counts.HILL || 0) < 100, `${seed}: few hills`);
      assert.ok((counts.FOREST || 0) + (counts.DEEPWOOD || 0) + (counts.SWAMP || 0) > 3000,
        `${seed}: woodland and marsh dominate`);
      assert.ok((counts.PLAINS || 0) + (counts.GRASS || 0) > 100, `${seed}: small clearings remain`);
    } else if (mapType === 'islands') {
      const { sizes, labels } = islandComponents(map.tiles);
      const large = sizes.filter(size => size >= 200).length;
      const small = sizes.filter(size => size >= 10 && size < 200).length;
      assert.ok(large >= 3 && large <= 6, `${seed}: ${large} large islands after occasional merges`);
      assert.ok(small >= 1, `${seed}: smaller islands`);
      assert.ok((counts.MOUNTAIN || 0) > 80 && (counts.RIVER || 0) > 0,
        `${seed}: island highlands and rivers`);
      assert.ok(game.castleAdj.coast, `${seed}: castle can build a port`);
      const home = labels[game.castle.y * debug.cols + game.castle.x];
      let remoteRich = 0;
      const richIslands = new Set();
      const remoteCells = [];
      for (let cell = 0; cell < game.richSites.length; cell++) {
        if (!game.richSites[cell] || labels[cell] === home) continue;
        assert.equal(game.discovered[cell], 0, `${seed}: distant shores begin under fog`);
        remoteCells.push(cell);
        richIslands.add(labels[cell]);
      }
      assert.ok(remoteCells.length >= 2 && richIslands.size >= 2, `${seed}: rich sites spread across distant islands`);
      debug.updateVisibility();
      assert.ok(remoteCells.some(cell => !game.discovered[cell]), `${seed}: shore sight has a finite radius`);
      game.coin = 1000;
      game.food = 1000;
      for (const cell of remoteCells) {
        const x = cell % debug.cols, y = (cell / debug.cols) | 0;
        game.discovered[cell] = 1; // model a hero discovering the remote shore
        const site = api.manualCanFoundVillage(x, y, 'fish');
        assert.ok(site.ok && site.seaLinked, `${seed}: remote rich shore ${x},${y} can be founded by sea`);
        remoteRich++;
      }
      assert.ok(remoteRich >= 2, `${seed}: rich sites on distant islands`);
    }
  }
}

for (let i = 1; i <= 100; i++) {
  const seed = Math.imul(i, 2654435761) >>> 0;
  api.newGame(seed, { mapType: 'islands', manual: true });
  const { map, game } = debug;
  const { sizes, labels } = islandComponents(map.tiles);
  const large = sizes.filter(size => size >= 200).length;
  const small = sizes.filter(size => size >= 10 && size < 200).length;
  const home = labels[game.castle.y * debug.cols + game.castle.x];
  const remoteIslands = new Set();
  const richPerIsland = new Uint8Array(debug.cols * debug.rows);
  let mountains = 0, rivers = 0;
  for (const row of map.tiles) for (const tile of row) {
    if (tile === 'MOUNTAIN') mountains++;
    else if (tile === 'RIVER') rivers++;
  }
  for (let cell = 0; cell < game.richSites.length; cell++)
    if (game.richSites[cell]) {
      const island = labels[cell];
      assert.ok(island >= 0 && ++richPerIsland[island] <= 2, `${seed}: at most two rich sites per island`);
      if (island !== home) remoteIslands.add(island);
    }
  assert.ok(large >= 3 && large <= 6 && small >= 1 && game.castleAdj.coast && remoteIslands.size >= 2
    && mountains > 80 && rivers > 0,
    `${seed}: complete archipelago (${large} large, ${small} small, ${remoteIslands.size} rich islands, ${mountains} mountains, ${rivers} river cells)`);
}

api.newGame(587033999, { manual: true });
let hash = 2166136261;
for (const row of debug.map.tiles) for (const tile of row)
  for (let i = 0; i < tile.length; i++) hash = Math.imul(hash ^ tile.charCodeAt(i), 16777619);
assert.equal(hash >>> 0, 2124097624, 'balanced map keeps the original seed layout');

assert.equal(api.newGame(587033999, { scenario: 'ore', mapType: 'islands', manual: true }).mapType, 'mountain');
assert.equal(api.newGame(587033999, { scenario: 'bandits', mapType: 'mountain', manual: true }).mapType, 'forest-swamp');
assert.equal(api.newGame(587033999, { scenario: 'winter', mapType: 'islands', manual: true }).mapType, 'islands');
console.log('Map type checks passed (100 archipelago seeds, four types, scenarios and sea-linked sites).');
