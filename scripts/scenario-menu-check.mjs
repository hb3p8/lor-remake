#!/usr/bin/env node
import assert from 'node:assert/strict';
import { loadSimulationApi } from './sim-runtime.mjs';

const ids = ['freeplay', 'charter', 'convoy', 'marches', 'winter', 'ore', 'crypt', 'bandits', 'trade'];

for (const [viewportWidth, viewportHeight] of [[390, 844], [390, 667], [390, 375], [320, 375], [390, 280], [280, 280]]) {
  const api = loadSimulationApi({ viewportWidth, viewportHeight });
  let menu = api.menuState();
  assert.equal(menu.viewMode, 'intro');
  assert.ok(api.menuRows().some(row => row.includes('THE OLD MARCH')));
  assert.ok(api.menuRows().some(row => row.includes('orders.')), 'Intro text is fully visible');
  assert.ok(api.menuRows().some(row => row.includes('[ CHOOSE A SCENARIO ]')));
  api.menuTap(5, menu.rows - 2);
  menu = api.menuState();
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
  let info = api.menuState();
  assert.equal(info.viewMode, 'confirm');
  assert.equal(info.pendingScenarioId, firstVisible);
  const confirmation = [];
  for (let page = 0; page < info.infoPages; page++) {
    confirmation.push(...api.menuRows());
    if (page + 1 < info.infoPages) {
      assert.ok(api.menuRows().some(row => row.includes('[ NEXT ]')));
      api.menuTap(info.cols - 1, info.rows - 4);
      info = api.menuState();
      assert.equal(info.infoPage, page + 1);
    }
  }
  for (const section of ['STORY', 'START', 'OBJECTIVE', 'FAILURE'])
    assert.ok(confirmation.some(row => row.trim() === section), `${section} reachable at ${viewportWidth}×${viewportHeight}px`);
  assert.ok(confirmation.some(row => row.includes('MAP:')), `Map type shown at ${viewportWidth}×${viewportHeight}px`);
  api.menuTap(5, info.rows - 6);
  assert.equal(api.menuState().pendingMapType, 'mountain', 'Map type cycles on the confirmation screen');
  api.menuTap(1, 0);
  assert.equal(api.menuState().viewMode, 'scenarios');
  api.menuTap(4, 4);
  info = api.menuState();
  api.menuTap(5, info.rows - 2);
  assert.equal(api.snapshot().scenarioId, firstVisible, `First visible scenario launches at ${viewportWidth}×${viewportHeight}px`);
  assert.equal(api.snapshot().mapType, 'mountain');
  assert.equal(api.menuState().seed, menu.seed, 'Requested seed remains available for returning to the menu');
  const world = api.menuState();
  assert.equal(world.viewMode, 'world');
  assert.ok(world.goalLines.length > 0);
  assert.equal(world.topRows, 1 + world.goalLines.length);
  assert.equal(world.mapRows, Math.max(1, world.viewRows - world.topRows - 3));
  assert.ok(world.goalLines.every(line => line.length <= world.barCols - 2));
  const bars = api.barRows();
  assert.equal(bars.length, world.topRows);
  assert.ok(bars[0].includes('Next turn'), 'Resource bar keeps the turn button visible');
  for (let row = 0; row < world.goalLines.length; row++)
    assert.equal(bars[row + 1].trim(), world.goalLines[row].trim());
  api.worldTap(0, 1);
  info = api.menuState();
  assert.equal(info.viewMode, 'objective');
  const objective = [];
  for (let page = 0; page < info.infoPages; page++) {
    objective.push(...api.menuRows());
    if (page + 1 < info.infoPages) {
      api.menuTap(info.cols - 1, info.rows - 4);
      info = api.menuState();
    }
  }
  for (const section of ['STORY', 'OBJECTIVE', 'FAILURE', 'PROGRESS'])
    assert.ok(objective.some(row => row.trim() === section), `${section} in game details at ${viewportWidth}×${viewportHeight}px`);
  api.menuTap(5, info.rows - 2);
  assert.equal(api.menuState().viewMode, 'world');
  for (let row = 0; row < world.goalLines.length; row++) {
    const firstMapCol = Math.ceil((world.goalLines[row].length + 1) / 2);
    if (firstMapCol >= world.viewCols) continue;
    assert.equal(api.barCellBackground(firstMapCol * 2 - 1, row + 1), '#252418');
    assert.equal(api.barCellBackground(firstMapCol * 2, row + 1), 'transparent');
    assert.ok(api.worldCellAt(firstMapCol, row + 1), 'Gap after goal text maps to a world cell');
    assert.ok(api.worldGlyphAt(firstMapCol, row + 1), 'World cell is rendered in the gap');
    assert.notEqual(api.worldTap(firstMapCol, row + 1), 'objective', 'Gap tap targets the map');
    break;
  }
}

for (const locationHref of ['https://example.test/game/?seed=123', 'https://example.test/game/#seed=456']) {
  const api = loadSimulationApi({ locationHref });
  const before = api.menuState();
  assert.equal(before.viewMode, 'intro');
  assert.equal(before.pinned, true);
  assert.equal(before.seed, locationHref.includes('123') ? 123 : 456);
  api.menuTap(5, before.rows - 2);
  api.menuTap(5, before.rows - 1);
  const after = api.menuState();
  assert.equal(after.pinned, false);
  assert.equal(after.urlSeed.includes('seed='), false);
  assert.notEqual(after.seed, before.seed);
}

{
  const api = loadSimulationApi({ viewportWidth: 280, viewportHeight: 280 });
  let menu = api.menuState();
  api.menuTap(5, menu.rows - 2);
  menu = api.menuState();
  const endings = {
    freeplay: 'holding should reach.', charter: 'before the second winter.',
    convoy: 'do not count.', marches: 'be held afterward.',
    winter: 'after the first winter.', ore: 'only valid site.', crypt: 'complete the writ.',
    bandits: 'stops recruitment.',
    trade: 'discovering it.',
  };
  for (const id of ids) {
    while (!menu.visible.includes(id)) {
      api.menuTap(menu.cols - 1, menu.rows - 6);
      menu = api.menuState();
    }
    api.menuTap(4, 4 + menu.visible.indexOf(id) * 3);
    let info = api.menuState();
    assert.equal(info.pendingScenarioId, id);
    const allRows = [];
    for (let page = 0; page < info.infoPages; page++) {
      allRows.push(...api.menuRows().slice(4, info.rows - 7));
      if (page + 1 < info.infoPages) {
        api.menuTap(info.cols - 1, info.rows - 4);
        info = api.menuState();
      }
    }
    for (const section of ['STORY', 'START', 'OBJECTIVE', 'FAILURE'])
      assert.ok(allRows.some(row => row.trim() === section), `${id} ${section} on short screen`);
    assert.ok(allRows.join(' ').replace(/\s+/g, ' ').includes(endings[id]), `${id} full objective on short screen`);
    api.menuTap(1, 0);
    menu = api.menuState();
    assert.equal(menu.viewMode, 'scenarios');
  }
}

{
  const api = loadSimulationApi({ viewportWidth: 280, viewportHeight: 280 });
  api.newGame(1592594996, { scenario: 'charter', render: true, manual: true });
  const world = api.menuState();
  assert.ok(world.goalLines.length >= 2, 'Long charter goal wraps above the map');
  assert.equal(api.worldTap(0, world.topRows - 1), 'objective', 'Every wrapped goal row opens details');
}

{
  const api = loadSimulationApi({ viewportWidth: 390, viewportHeight: 375 });
  api.newGame(1592594996, { scenario: 'winter', render: true, manual: true });
  const world = api.menuState();
  assert.ok(world.goalLines.length >= 2, 'Winter goal wraps like the mobile layout');
  const lastGoalRow = world.goalLines.length;
  const firstMapCol = Math.ceil((world.goalLines[lastGoalRow - 1].length + 1) / 2);
  assert.ok(firstMapCol < world.viewCols);
  assert.equal(api.barCellBackground(firstMapCol * 2, lastGoalRow), 'transparent');
  assert.ok(api.worldGlyphAt(firstMapCol, lastGoalRow));
  assert.notEqual(api.worldTap(firstMapCol, lastGoalRow), 'objective');
}

{
  const api = loadSimulationApi();
  const requestedSeed = 247916511;
  const snapshot = api.newGame(requestedSeed, { scenario: 'ore', mapType: 'islands', manual: true });
  assert.equal(snapshot.mapType, 'mountain', 'Ore scenario requests its own map type');
  assert.equal(api.menuState().seed, requestedSeed, 'Scenario setup keeps the requested menu seed');
}

console.log('Scenario menu checks passed at six mobile sizes and with pinned URL seeds.');
