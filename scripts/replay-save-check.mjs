import assert from 'node:assert/strict';
import { loadSimulationApi } from './sim-runtime.mjs';

const context = loadSimulationApi({ context: true });
const api = context.window.__lorTest;
api.newGame(587033999, { manual: true, history: true });
const d = context.window.__lorDebug;
const initial = api.historyState();
assert.ok(initial.id);
assert.equal(initial.commands.length, 0);
assert.equal(initial.checkpoints.length, 1);
assert.equal(api.manualBuild('rangers'), true);
assert.equal(api.manualBuild('rangers'), false, 'failed actions are omitted');
api.stepTurn();
api.stepTurn();
const bounty = api.manualBounty('explore', { x: d.game.castle.x + 9, y: d.game.castle.y });
assert.ok(bounty);
api.stepTurn();
const history = api.historyState();
assert.equal(history.commands.length, 5);
const hashes = history.commands.map(command => command.hash);

assert.equal(await api.historyOpen(initial.id), true);
assert.equal(api.historyState().cursorSeq, 5);
for (let seq = 0; seq <= 5; seq++) {
  assert.equal(await api.historySeek(seq), true, `seek to command ${seq}`);
  assert.equal(api.historyState().replayError, '');
  if (seq) assert.equal(api.historyState().hash, hashes[seq - 1]);
}
assert.equal(await api.historyBranch(), true);
assert.notEqual(api.historyState().id, initial.id, 'branch has its own save');
assert.equal(api.historyState().commands.length, 0);
api.historyExit();

api.newGame(587033999, { manual: true, history: true });
const liveId = api.historyState().id;
const timers = [];
const liveStates = [];
const originalTimeout = context.window.setTimeout;
context.window.setTimeout = fn => { timers.push(fn); return timers.length; };
for (let turn = 0; turn < 12; turn++) {
  api.worldTap(api.menuState().viewCols - 1, 0);
  for (let i = 0; i < 20000 && timers.length; i++) timers.shift()();
  assert.equal(timers.length, 0, `animated turn ${turn + 1} completed`);
  liveStates.push(structuredClone({ map: d.map, game: d.game }));
}
context.window.setTimeout = originalTimeout;
assert.equal(api.historyState().commands.length, 12);
assert.equal(await api.historyOpen(liveId), true);
for (const seq of [0, 1, 7, 9, 12, 5, 12]) {
  const okay = await api.historySeek(seq);
  if (!okay) {
    const expected = liveStates[Number(api.historyState().replayError.match(/command (\d+)/)?.[1] || seq) - 1];
    if (expected) for (const key of Object.keys(expected.game)) {
      if (['simStats', 'pathScratch', 'caches', 'log', 'reports', 'feed', 'battleLog'].includes(key)) continue;
      if (JSON.stringify(expected.game[key]) !== JSON.stringify(d.game[key])) console.log('DIFF', key);
    }
  }
  assert.equal(okay, true, `animated replay seeks to action ${seq}`);
}

console.log('Replay command log, snapshot seek, and branch: OK');
