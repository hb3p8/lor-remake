#!/usr/bin/env node
import assert from 'node:assert/strict';
import { loadSimulationApi } from './sim-runtime.mjs';

const context = loadSimulationApi({ context: true });
const api = context.window.__lorTest;
const debug = context.window.__lorDebug;
const seeds = [587033999, 1592594996, 25, 1151, 2222];
const sea = new Set(['WATER', 'DEEP', 'RIVER']);

function islandSizes(tiles) {
  const seen = new Uint8Array(debug.cols * debug.rows);
  const sizes = [];
  const queue = new Int16Array(seen.length);
  for (let start = 0; start < seen.length; start++) {
    const sx = start % debug.cols, sy = (start / debug.cols) | 0;
    if (seen[start] || sea.has(tiles[sy][sx])) continue;
    let head = 0, tail = 0;
    seen[start] = 1;
    queue[tail++] = start;
    while (head < tail) {
      const cell = queue[head++], x = cell % debug.cols, y = (cell / debug.cols) | 0;
      const adjacent = [cell - 1, cell + 1, cell - debug.cols, cell + debug.cols];
      for (const next of adjacent) {
        if (next < 0 || next >= seen.length || seen[next] ||
            Math.abs(next % debug.cols - x) + Math.abs(((next / debug.cols) | 0) - y) !== 1) continue;
        const nx = next % debug.cols, ny = (next / debug.cols) | 0;
        if (sea.has(tiles[ny][nx])) continue;
        seen[next] = 1;
        queue[tail++] = next;
      }
    }
    sizes.push(tail);
  }
  return sizes;
}

for (const mapType of ['balanced', 'mountain', 'forest-swamp', 'islands']) {
  for (const seed of seeds) {
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
      const sizes = islandSizes(map.tiles);
      const large = sizes.filter(size => size >= 200).length;
      const small = sizes.filter(size => size >= 10 && size < 200).length;
      assert.ok(large >= 4 && large <= 6, `${seed}: ${large} large islands`);
      assert.ok(small >= 1, `${seed}: smaller islands`);
      assert.ok(game.castleAdj.coast, `${seed}: castle can build a port`);
      const home = game.caches.component[game.castle.y * debug.cols + game.castle.x];
      game.coin = 1000;
      game.food = 1000;
      let remoteRich = 0;
      const richIslands = new Set();
      for (let cell = 0; cell < game.richSites.length; cell++) {
        if (!game.richSites[cell] || game.caches.component[cell] === home) continue;
        const x = cell % debug.cols, y = (cell / debug.cols) | 0;
        const site = api.manualCanFoundVillage(x, y, 'fish');
        assert.ok(site.ok && site.seaLinked, `${seed}: remote rich shore ${x},${y} can be founded by sea`);
        remoteRich++;
        richIslands.add(game.caches.component[cell]);
      }
      assert.ok(remoteRich >= 2, `${seed}: rich sites on distant islands`);
      assert.ok(richIslands.size >= 2, `${seed}: rich sites spread across islands`);
    }
  }
}

api.newGame(587033999, { manual: true });
let hash = 2166136261;
for (const row of debug.map.tiles) for (const tile of row)
  for (let i = 0; i < tile.length; i++) hash = Math.imul(hash ^ tile.charCodeAt(i), 16777619);
assert.equal(hash >>> 0, 2124097624, 'balanced map keeps the original seed layout');

assert.equal(api.newGame(587033999, { scenario: 'ore', mapType: 'islands', manual: true }).mapType, 'mountain');
assert.equal(api.newGame(587033999, { scenario: 'bandits', mapType: 'mountain', manual: true }).mapType, 'forest-swamp');
assert.equal(api.newGame(587033999, { scenario: 'winter', mapType: 'islands', manual: true }).mapType, 'islands');
console.log('Map type checks passed (five seeds, four types, scenario overrides and sea-linked rich sites).');
