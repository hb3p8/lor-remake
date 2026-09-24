#!/usr/bin/env node
import assert from 'node:assert/strict';
import { loadSimulationApi } from './sim-runtime.mjs';

const ids = ['freeplay', 'charter', 'convoy', 'marches', 'winter', 'ore', 'crypt'];

for (const viewportHeight of [844, 667, 375, 280]) {
  const api = loadSimulationApi({ viewportWidth: 390, viewportHeight });
  let menu = api.menuState();
  assert.equal(menu.viewMode, 'scenarios');
  assert.ok(api.menuRows().some(row => row.includes('[ NEW MAP ]')));
  const seen = new Set();
  for (let page = 0; page < ids.length; page++) {
    for (const id of menu.visible) seen.add(id);
    if (seen.size === ids.length) break;
    assert.ok(api.menuRows().some(row => row.includes('[ NEXT ]')));
    const next = api.menuTap(menu.cols - 1, menu.rows - 6);
    assert.equal(next.page, menu.page + 1, `Next page at ${viewportHeight}px`);
    menu = api.menuState();
  }
  assert.deepEqual([...seen].sort(), [...ids].sort(), `All scenarios reachable at ${viewportHeight}px`);

  const previousSeed = menu.seed;
  api.menuTap(5, menu.rows - 1);
  menu = api.menuState();
  assert.notEqual(menu.seed, previousSeed, `New Map changes the seed at ${viewportHeight}px`);
  const firstVisible = menu.visible[0];
  api.menuTap(4, 4);
  assert.equal(api.snapshot().scenarioId, firstVisible, `First visible scenario launches at ${viewportHeight}px`);
}

for (const locationHref of ['https://example.test/game/?seed=123', 'https://example.test/game/#seed=456']) {
  const api = loadSimulationApi({ locationHref });
  const before = api.menuState();
  assert.equal(before.pinned, true);
  assert.equal(before.seed, locationHref.includes('123') ? 123 : 456);
  api.menuTap(5, before.rows - 1);
  const after = api.menuState();
  assert.equal(after.pinned, false);
  assert.equal(after.urlSeed.includes('seed='), false);
  assert.notEqual(after.seed, before.seed);
}

console.log('Scenario menu checks passed at four heights and with pinned URL seeds.');
