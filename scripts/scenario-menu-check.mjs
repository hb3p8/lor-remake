#!/usr/bin/env node
import assert from 'node:assert/strict';
import { loadSimulationApi } from './sim-runtime.mjs';

const ids = ['freeplay', 'charter', 'convoy', 'marches', 'winter', 'ore', 'crypt'];

for (const [viewportWidth, viewportHeight] of [[390, 844], [390, 667], [390, 375], [320, 375], [390, 280]]) {
  const api = loadSimulationApi({ viewportWidth, viewportHeight });
  let menu = api.menuState();
  assert.equal(menu.viewMode, 'scenarios');
  assert.ok(api.menuRows().some(row => row.includes('[ NEW MAP ]')));
  const seen = new Set();
  for (let page = 0; page < ids.length; page++) {
    for (const id of menu.visible) seen.add(id);
    if (seen.size === ids.length) break;
    assert.ok(api.menuRows().some(row => row.includes('[ NEXT ]')));
    const next = api.menuTap(menu.cols - 1, menu.rows - 6);
    assert.equal(next.page, menu.page + 1, `Next page at ${viewportWidth}×${viewportHeight}px`);
    menu = api.menuState();
  }
  assert.deepEqual([...seen].sort(), [...ids].sort(), `All scenarios reachable at ${viewportWidth}×${viewportHeight}px`);

  const previousSeed = menu.seed;
  api.menuTap(5, menu.rows - 1);
  menu = api.menuState();
  assert.notEqual(menu.seed, previousSeed, `New Map changes the seed at ${viewportWidth}×${viewportHeight}px`);
  const firstVisible = menu.visible[0];
  api.menuTap(4, 4);
  assert.equal(api.snapshot().scenarioId, firstVisible, `First visible scenario launches at ${viewportWidth}×${viewportHeight}px`);
  assert.equal(api.menuState().seed, menu.seed, 'Requested seed remains available for returning to the menu');
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

console.log('Scenario menu checks passed at five mobile sizes and with pinned URL seeds.');
