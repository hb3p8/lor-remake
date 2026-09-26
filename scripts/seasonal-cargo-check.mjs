import assert from 'node:assert/strict';
import { loadSimulationApi } from './sim-runtime.mjs';

const context = loadSimulationApi({ context: true });
const api = context.window.__lorTest;
api.newGame(587033999, { manual: true, mapType: 'islands' });
const d = context.window.__lorDebug;
const { game, map, cols, rows } = d;
const cx = game.castle.x, cy = game.castle.y;
const tx = cx < cols / 2 ? cx + 24 : cx - 24;

for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) map.tiles[y][x] = 'DEEP';
for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
  map.tiles[cy + dy][cx + dx] = 'PLAINS';
  map.tiles[cy + dy][tx + dx] = 'PLAINS';
}
for (let x = Math.min(cx, tx); x <= Math.max(cx, tx); x++) map.tiles[cy - 1][x] = 'DEEP';
map.tiles[cy][cx] = 'CASTLE';
game.actors.length = 0;
game.hostiles.length = 0;
game.lairs.length = 0;
game.villages.length = 0;
game.discovered.fill(1);
game.discoveredTotal = cols * rows;
game.coin = 1000;
game.food = 1000;
game.caches = d.makeWorldCaches(map, game.castle);
game.pathScratch = d.makePathScratch();

const founded = d.foundVillageAt(tx, cy, 'fields');
assert.equal(founded.ok, true, JSON.stringify(founded));
const village = founded.village;
assert.equal(village.seaLinked, true);
village.foodRate = 0;
village.winterFoodRate = 0;
village.coinRate = 0;
village.storedFood = 12;
village.storedCoin = 8;
d.spawnVillageCart(village, []);
const cargo = game.actors[game.actors.length - 1];
assert.equal(cargo.boat, true);
d.computeTurnPlan({ recordMoves: false, events: [] });
assert.equal(map.tiles[cargo.y][cargo.x], 'DEEP', 'summer boat is still crossing the sea');

game.turn = game.seasonEnds;
d.bigTurnEconomy([]);
assert.equal(game.season, 'winter');
assert.equal(cargo.boat, false, 'boat becomes a cart on winter ice');
assert.equal(cargo.glyph, 'c');
assert.equal(cargo.steps, 4);
assert.equal(cargo.foodPayload, 12);
assert.equal(cargo.coinPayload, 8);
assert.equal(cargo.deliveryId, 'castle');
assert.equal(cargo.goal, null, 'old sea route is discarded');
assert.ok(d.findPath(cargo, game.castle)?.some(p => map.tiles[p.y][p.x] === 'DEEP'));
d.computeTurnPlan({ recordMoves: false, events: [] });
assert.equal(map.tiles[cargo.y][cargo.x], 'DEEP', 'winter cart advances over the ice');

game.turn = game.seasonEnds;
d.bigTurnEconomy([]);
assert.equal(game.season, 'summer');
assert.equal(cargo.boat, true, 'cart becomes a boat at the thaw');
assert.equal(cargo.glyph, 'b');
assert.equal(cargo.steps, 6);
assert.equal(cargo.hp, cargo.maxHp, 'the boat is not injured by thawing ice');
assert.equal(cargo.goal, null, 'old ice route is discarded');
const foodBefore = game.food, coinBefore = game.coin;
for (let i = 0; i < 12 && cargo.alive; i++) d.computeTurnPlan({ recordMoves: false, events: [] });
assert.equal(cargo.delivered, true, 'cargo finishes its crossing after both season changes');
assert.equal(game.food - foodBefore, 12);
assert.equal(game.coin - coinBefore, 8);

village.storedFood = 5;
village.cartTimer = 0;
game.season = 'winter';
d.tickVillages([]);
const winterCargo = game.actors[game.actors.length - 1];
assert.equal(winterCargo.boat, false, 'new winter shipment starts as a cart');
assert.equal(winterCargo.deliveryId, 'castle');
assert.ok(d.findPath(winterCargo, game.castle));

// On other map types deep sea stays liquid, so a vessel already at sea
// must keep sailing rather than turn into a stranded cart.
map.mapType = 'balanced';
game.caches = d.makeWorldCaches(map, game.castle);
winterCargo.x = (cx + tx) >> 1;
winterCargo.y = cy;
winterCargo.boat = true;
winterCargo.steps = 6;
winterCargo.goal = null;
game.season = 'summer';
game.turn = game.seasonEnds;
d.bigTurnEconomy([]);
assert.equal(winterCargo.boat, true, 'cargo stays afloat where the deep sea does not freeze');
assert.equal(winterCargo.hp, winterCargo.maxHp);
const seaX = winterCargo.x;
d.computeTurnPlan({ recordMoves: false, events: [] });
assert.notEqual(winterCargo.x, seaX, 'the boat keeps moving over open water in winter');

console.log('Seasonal boat/cart cargo crossing and winter departure: OK');
