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
const file = await api.historyExport(initial.id);
const decoded = api.historyDecodeFile(file);
assert.equal(decoded.party.commands.length, history.commands.length);
assert.equal(decoded.party.currentSnapshot.map.seed, 587033999);
assert.equal(Object.prototype.toString.call(decoded.party.currentSnapshot.game.discovered), '[object Uint8Array]');
const shared = { hp: 9 };
const graph = { shared, again: shared, bytes: new Uint16Array([1, 256, 65535]),
  set: new Set([shared]), map: new Map([[shared, 'hero']]) };
graph.self = graph;
const rebuilt = api.historyCodecRoundtrip(graph);
assert.equal(rebuilt.shared, rebuilt.again);
assert.equal(rebuilt.self, rebuilt);
assert.equal(rebuilt.set.has(rebuilt.shared), true);
assert.equal(rebuilt.map.get(rebuilt.shared), 'hero');
assert.deepEqual(Array.from(rebuilt.bytes), [1, 256, 65535]);

assert.equal(await api.historyOpen(initial.id), true);
assert.equal(api.historyState().cursorSeq, 5);
api.worldTap(Math.floor(api.menuState().viewCols * 0.375), api.menuState().viewRows - 2);
assert.equal(api.historyState().replaySpeed, 2);
api.worldTap(Math.floor(api.menuState().viewCols * 0.55), api.menuState().viewRows - 2);
assert.equal(api.menuState().viewMode, 'timeline');
api.menuTap(api.menuState().cols - 6, 1);
assert.equal(api.menuState().viewMode, 'replayDelete');
api.menuTap(2, api.menuState().rows - 7);
assert.equal(api.menuState().viewMode, 'timeline');
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
const transient = new Set(['simStats', 'pathScratch', 'caches', 'log', 'reports', 'feed', 'battleLog', 'lastTurnEvents']);
function gameplayState(value, seen = new WeakSet()) {
  if (!value || typeof value !== 'object' || ArrayBuffer.isView(value) || seen.has(value)) return value;
  seen.add(value);
  if (value instanceof Set) for (const item of value) gameplayState(item, seen);
  else if (value instanceof Map) for (const [key, item] of value) { gameplayState(key, seen); gameplayState(item, seen); }
  else for (const key of Object.keys(value)) {
    if (transient.has(key)) delete value[key];
    else gameplayState(value[key], seen);
  }
  return value;
}
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
  if (seq) assert.deepEqual(gameplayState(structuredClone({ map: d.map, game: d.game })),
    gameplayState(structuredClone(liveStates[seq - 1])), `full gameplay state at action ${seq}`);
}

api.newGame(12345, { history: true, policy: 'heroes' });
const stewardId = api.historyState().id;
assert.equal(api.historyState().commands[0].type, 'setSteward');
api.stepTurn();
assert.equal(await api.historyOpen(stewardId), true);
assert.equal(await api.historySeek(0), true);
assert.equal(await api.historySeek(2), true);

console.log('Replay command log, snapshot seek, and branch: OK');
