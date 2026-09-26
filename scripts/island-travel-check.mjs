import assert from 'node:assert/strict';
import { loadSimulationApi } from './sim-runtime.mjs';

const context = loadSimulationApi({ context: true });
const api = context.window.__lorTest;
api.newGame(587033999, { manual: true, mapType: 'islands' });
const d = context.window.__lorDebug;
const { game, map, cols, rows } = d;
const cx = game.castle.x, cy = game.castle.y;
const tx = cx < cols / 2 ? cx + 18 : cx - 18;

// Two small islands separated by deep sea, with no alternate land route.
for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) map.tiles[y][x] = 'DEEP';
for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
  map.tiles[cy + dy][cx + dx] = 'PLAINS';
  map.tiles[cy + dy][tx + dx] = 'PLAINS';
}
map.tiles[cy][cx] = 'CASTLE';
game.actors.length = 0;
game.hostiles.length = 0;
game.lairs.length = 0;
game.villages.length = 0;
game.watchtowers.length = 0;
game.discovered.fill(0);
game.visible.fill(0);
game.discoveredTotal = 0;
game.caches = d.makeWorldCaches(map, game.castle);
game.pathScratch = d.makePathScratch();
game.built.push('rangers');
game.coin = 1000;
assert.ok(api.manualHire('ranger'));
const hero = game.actors.find(a => a.hero);
const target = { x: tx, y: cy };

game.season = 'summer';
d.updateVisibility();
assert.equal(game.discovered[cy * cols + tx], 0, 'the opposite shore stays hidden');
assert.equal(game.discovered[cy * cols + (cx < tx ? cx + 12 : cx - 12)], 0,
  'shore sight does not chart the whole sea');
game.built.push('port');
d.updateVisibility();
assert.equal(game.discovered[cy * cols + tx], 0, 'a port does not reveal a remote coast');
assert.equal(d.findPath(hero, target), null, 'deep sea blocks walking in summer');

game.season = 'winter';
game.caches.frontierDirty = 1;
d.updateVisibility();
const path = d.findPath(hero, target);
assert.ok(path && path.some(p => map.tiles[p.y][p.x] === 'DEEP'),
  'a winter path should cross frozen deep sea');
assert.ok(game.caches.frontier.some(cell => map.tiles[(cell / cols) | 0][cell % cols] === 'DEEP'),
  'frozen sea should provide exploration targets');
const autoGoal = api._goalProbeChoose(hero);
assert.ok(autoGoal && autoGoal.path.some(p => map.tiles[p.y][p.x] === 'DEEP'),
  'a ranger should choose an ice frontier on its own');
hero.goal = { type: 'explore', target, path: path.slice(1), committedAtTurn: game.turn,
  bountyRevision: game.bountyRevision };
for (let i = 0; i < 8 && hero.x !== tx; i++) d.computeTurnPlan({ recordMoves: false, events: [] });
assert.equal(hero.x, tx, 'hero should walk across the ice to the opposite island');
assert.equal(game.discovered[cy * cols + tx], 1, 'the crossing reveals the far shore');

// A hero still on the ice when spring arrives must be washed to land.
const iceX = cx < tx ? cx + 5 : cx - 5;
hero.x = iceX;
hero.y = cy;
hero.goal = null;
hero.hp = hero.maxHp;
game.turn = game.seasonEnds;
api.stepTurn();
assert.equal(game.season, 'summer');
assert.notEqual(map.tiles[hero.y][hero.x], 'DEEP');
assert.ok(hero.hp <= Math.ceil(hero.maxHp * 0.5), 'thaw should injure a stranded hero');

console.log('Island shore sight and winter ice crossing: OK');
