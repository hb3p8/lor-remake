import assert from 'node:assert/strict';
import { loadSimulationApi } from './sim-runtime.mjs';

const api = loadSimulationApi({ viewportWidth: 390, viewportHeight: 844 });
api.newGame(587033999, { manual: true, history: true, render: true });
const partyId = api.historyState().id;

function tapLabel(label) {
  const rows = api.menuRows();
  const y = rows.findIndex(row => row.includes(label));
  assert.ok(y >= 0, `${label} is visible`);
  api.menuTap(rows[y].indexOf(label) + Math.floor(label.length / 2), y);
}

assert.ok(api.barRows()[0].includes('Menu'));
api.worldTap(2, 0);
assert.equal(api.menuState().viewMode, 'pauseMenu');
tapLabel('[ SETTINGS ]');
assert.equal(api.menuState().viewMode, 'gameSettings');
api.menuTap(28, 1);
assert.equal(api.menuState().viewMode, 'gameSettings', 'heading outside Back is inert');
tapLabel('[ LIVE TURN ANIMATION: ON ]');
assert.ok(api.menuRows().some(row => row.includes('[ LIVE TURN ANIMATION: OFF ]')));
tapLabel('[ LIVE ANIMATION SPEED: ×1 ]');
assert.ok(api.menuRows().some(row => row.includes('[ LIVE ANIMATION SPEED: ×2 ]')));
tapLabel('[ BACK ]');
assert.equal(api.menuState().viewMode, 'pauseMenu');
tapLabel('[ LOAD GAME ]');
assert.equal(api.menuState().viewMode, 'loadGame');
assert.ok(api.menuRows().some(row => row.includes('freeplay · T1')));
tapLabel('[ BACK ]');
assert.equal(api.menuState().viewMode, 'pauseMenu');
tapLabel('[ BACK ]');
assert.equal(api.menuState().viewMode, 'world');
const beforeTurn = api.snapshot().turn;
api.worldTap(api.menuState().viewCols - 1, 0);
assert.equal(api.snapshot().turn, beforeTurn + 1, 'turn completes with animation disabled');

assert.equal(await api.historyOpen(partyId), true);
api.worldTap(Math.floor(api.menuState().viewCols * 0.55), api.menuState().viewRows - 2);
assert.equal(api.menuState().viewMode, 'timeline');
api.menuTap(17, 1);
assert.equal(api.menuState().viewMode, 'timeline', 'timeline heading outside buttons is inert');
tapLabel('[ DEL ]');
assert.equal(api.menuState().viewMode, 'replayDelete');
tapLabel('[ CANCEL ]');
assert.equal(api.menuState().viewMode, 'timeline');
tapLabel('[ MAP ]');
assert.equal(api.menuState().viewMode, 'world');

console.log('Menu and replay button hit areas: OK');
