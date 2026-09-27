import assert from 'node:assert/strict';
import { loadSimulationApi } from './sim-runtime.mjs';

const context = loadSimulationApi({ context: true });
const api = context.window.__lorTest;
const d = context.window.__lorDebug;
api.newGame(2222, { manual: true });
const { game, map, cols, rows } = d;
const cx = game.castle.x, cy = game.castle.y;
const vx = cx + 8 < cols - 4 ? cx + 8 : cx - 8;
assert.ok(cy + 3 < rows);
for (let y = 0; y < rows; y++) map.tiles[y].fill('PLAINS');
map.tiles[cy][cx] = 'CASTLE';
game.actors.length = 0;
game.hostiles.length = 0;
game.lairs.length = 0;
game.neighbors.length = 0;
game.villages.length = 0;
game.richSites.fill(0);
game.discovered.fill(1);
game.discoveredTotal = cols * rows;
game.coin = 1000;
game.food = 1000;

const timber = [[vx + 1, cy], [vx, cy + 1], [vx + 1, cy + 1], [vx - 1, cy + 1]];
for (const [x, y] of timber) map.tiles[y][x] = 'FOREST';
const marked = [vx + 2, cy], lair = [vx + 2, cy + 1];
map.tiles[marked[1]][marked[0]] = 'FOREST';
map.tiles[lair[1]][lair[0]] = 'DEEPWOOD';
game.richSites[marked[1] * cols + marked[0]] = 2;
game.lairs.push({ x: lair[0], y: lair[1], destroyed: false });
game.caches = d.makeWorldCaches(map, game.castle);
game.pathScratch = d.makePathScratch();

const preview = d.canFoundVillageAt(vx, cy, 'woodcutters');
assert.equal(preview.ok, true, JSON.stringify(preview));
assert.equal(preview.woodTrees, 4, 'marked sites and lairs are excluded');
assert.equal(preview.coinRate, 0, 'timber yields discrete carts rather than passive coin');
const result = d.foundVillageAt(vx, cy, 'woodcutters');
assert.equal(result.ok, true, JSON.stringify(result));
const village = result.village;
assert.equal(village.woodTimer, 4);
for (let i = 0; i < 3; i++) d.tickVillages([]);
assert.equal(game.actors.filter(a => a.cart).length, 0);
assert.equal(timber.filter(([x, y]) => map.tiles[y][x] === 'PLAINS').length, 0);
const events = [];
d.tickVillages(events);
assert.equal(timber.filter(([x, y]) => map.tiles[y][x] === 'PLAINS').length, 1);
assert.equal(game.actors.filter(a => a.cart).length, 1);
const cart = game.actors.find(a => a.cart);
assert.equal(cart.coinPayload, 30);
assert.equal(cart.foodPayload, 0);
assert.equal(village.woodTimer, 4);
assert.equal(map.tiles[marked[1]][marked[0]], 'FOREST');
assert.equal(map.tiles[lair[1]][lair[0]], 'DEEPWOOD');

village.built.push('inn');
for (let i = 0; i < 4; i++) d.tickVillages(events);
assert.equal(timber.filter(([x, y]) => map.tiles[y][x] === 'PLAINS').length, 2);
assert.equal(game.actors.filter(a => a.cart && a.coinPayload === 30).length, 2,
  'inn income travels separately from each 30-coin timber cart');
for (const [x, y] of timber) map.tiles[y][x] = 'PLAINS';
for (let i = 0; i < 4; i++) d.tickVillages(events);
assert.equal(village.alive, false);
assert.ok(events.some(e => e.includes('timber remains')));
assert.equal(cart.alive, true, 'the final cargo can still reach the keep');
assert.equal(map.tiles[marked[1]][marked[0]], 'FOREST');
assert.equal(map.tiles[lair[1]][lair[0]], 'DEEPWOOD');

// A real forest route can clear several trees before the village is placed.
// The preview must count the reserve after that road has been carved.
api.newGame(2222, { manual: true, mapType: 'balanced' });
d.game.discovered.fill(1);
d.game.discoveredTotal = d.cols * d.rows;
d.game.coin = 1000;
d.game.food = 1000;
d.game.actors.length = 0;
d.game.hostiles.length = 0;
d.game.lairs.length = 0;
const roadPreview = d.canFoundVillageAt(61, 23, 'woodcutters');
assert.equal(roadPreview.ok, true);
const roadVillage = d.foundVillageAt(61, 23, 'woodcutters').village;
let actualTrees = 0;
for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
  if (!dx && !dy) continue;
  const x = roadVillage.x + dx, y = roadVillage.y + dy;
  const tile = d.map.tiles[y][x];
  if ((tile === 'FOREST' || tile === 'DEEPWOOD') && !d.game.richSites[y * d.cols + x]) actualTrees++;
}
assert.equal(roadPreview.woodTrees, actualTrees);

console.log('Woodcutter four-turn harvest, protected trees, 30-coin cart and exhaustion: OK');
