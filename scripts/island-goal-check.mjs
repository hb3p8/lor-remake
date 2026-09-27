import assert from 'node:assert/strict';
import { loadSimulationApi } from './sim-runtime.mjs';

const context = loadSimulationApi({ context: true });
const api = context.window.__lorTest;
api.newGame(4007117023, { manual: true, mapType: 'islands' });
const d = context.window.__lorDebug;
const { game, map, cols, rows } = d;
const cx = game.castle.x, cy = game.castle.y;
const ruin = { x: cx + 2, y: cy + 1 };
const ruinCell = ruin.y * cols + ruin.x;

// Two pieces of land touch diagonally across a water corner. A path cannot
// cross that corner in summer, so the reachability cache must not join them.
for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) map.tiles[y][x] = 'DEEP';
map.tiles[cy][cx] = 'CASTLE';
map.tiles[cy][cx + 1] = 'GRASS';
map.tiles[ruin.y][ruin.x] = 'RUIN';
game.caches = d.makeWorldCaches(map, game.castle);
game.pathScratch = d.makePathScratch();
game.actors.length = 0;
game.hostiles.length = 0;
game.lairs.length = 0;
game.villages.length = 0;
game.bounties.length = 0;
game.built.push('rangers');
game.coin = 1000;
assert.ok(api.manualHire('ranger'));
const ranger = game.actors.find(actor => actor.hero && actor.role === 'ranger');
ranger.x = cx + 1;
ranger.y = cy;
ranger.purse = 10;
game.discovered.fill(1);
game.exploredRuins.clear();
game.caches.frontier = [ruinCell];
game.caches.frontierMark[ruinCell] = 1;

const startCell = cy * cols + ranger.x;
assert.notEqual(game.caches.component[startCell], game.caches.component[ruinCell]);
assert.equal(d.findPath(ranger, ruin), null);
const candidates = api._goalProbeCandidates(ranger);
assert.equal(candidates.some(candidate => candidate.type === 'delve' || candidate.type === 'explore'), false,
  'an unreachable ruin or frontier must not suppress fallback goals');
assert.equal(candidates[0].type, 'carouse');
assert.ok(d.findPath(ranger, candidates[0].target)?.length >= 2);
assert.equal(api._goalProbeChoose(ranger)?.type, 'carouse');

assert.equal(game.caches.winterComponent[startCell], game.caches.winterComponent[ruinCell],
  'frozen island sea joins the land in winter');
game.season = 'winter';
assert.ok(d.findPath(ranger, ruin)?.length >= 2);

console.log('Island ranger goal reachability: OK');
