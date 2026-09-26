import assert from 'node:assert/strict';
import { loadSimulationApi } from './sim-runtime.mjs';

const context = loadSimulationApi({ context: true });
context.window.__lorTest.newGame(587033999, { manual: true });
const d = context.window.__lorDebug;
const { game, map, cols, rows } = d;
const cx = game.castle.x, cy = game.castle.y;
const rx = cx < cols / 2 ? cx + 35 : cx - 35;
const inlandY = cy + 10 < rows - 2 ? cy + 10 : cy - 10;

// A controlled map makes shore routes independent of the random generator.
for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) map.tiles[y][x] = 'PLAINS';
for (let x = 1; x < cols - 1; x++) map.tiles[cy - 1][x] = 'WATER';
map.tiles[inlandY - 1][rx] = 'WATER';
map.tiles[cy][cx] = 'CASTLE';
game.discovered.fill(1);
game.discoveredTotal = cols * rows;
game.coin = 1000; game.food = 1000;
game.actors.length = 0; game.hostiles.length = 0; game.lairs.length = 0;
game.caches = d.makeWorldCaches(map, game.castle);
game.pathScratch = d.makePathScratch();

assert.equal(d.canFoundVillageAt(rx, inlandY).ok, false, 'unconnected coast must not found remotely');
const nearX = cx + (rx > cx ? 10 : -10);
assert.equal(d.canFoundVillageAt(nearX, cy).seaLinked, false, 'a legal short road wins over the sea');
const preview = d.canFoundVillageAt(rx, cy);
assert.equal(preview.seaLinked, true);
assert.equal(preview.pathLen, 12, 'sea cost should not scale with land distance');
const founded = d.foundVillageAt(rx, cy, 'fields');
assert.equal(founded.ok, true);
const village = founded.village;
assert.equal(village.roadCells.length, 0, 'remote village should not carve a road');

village.storedFood = 12; village.storedCoin = 8;
d.spawnVillageCart(village, []);
const boat = game.actors[game.actors.length - 1];
assert.equal(boat.boat, true);
const boatPath = d.findPath(boat, game.castle);
assert.ok(boatPath.length > 2, 'boat should cross water cells');
boat.goal = { type: 'deliver', target: { x: cx, y: cy }, path: boatPath.slice(1) };
const foodBefore = game.food, coinBefore = game.coin;
for (let i = 0; i < 12 && boat.alive; i++) d.computeTurnPlan({ recordMoves: false, events: [] });
assert.equal(boat.delivered, true);
assert.equal(game.food - foodBefore, 12);
assert.equal(game.coin - coinBefore, 8);

game.castleAdj.coast = true; game.autoSteward = true; game.heroSeq = 1;
d.runSteward();
assert.equal(game.building?.id, 'port', 'Steward should queue a keep port for a connected coastal village');
game.building = null; game.autoSteward = false;
village.built = ['port']; game.built.push('port');
const hero = { id: 'test-hero', role: 'ranger', hero: true, ownerId: game.id,
  x: cx, y: cy, steps: 5.8, alive: true, hp: 10, maxHp: 10 };
assert.equal(d.findPath(hero, village).length, 2, 'ports should give a direct travel edge');
game.built.push('rangers');
assert.ok(context.window.__lorTest.manualHire('ranger'));
const sailingHero = game.actors.find(a => a.alive && a.hero);
sailingHero.goal = { type: 'explore', target: { x: village.x, y: village.y },
  path: [{ x: village.x, y: village.y }], committedAtTurn: game.turn,
  bountyRevision: game.bountyRevision };
const sailingPlan = d.computeTurnPlan({ recordMoves: true, events: [] });
const sailingPath = sailingPlan.moves.find(m => m.actor === sailingHero).path;
assert.ok(sailingPath.length > 2, 'hero should visibly move through sea cells');
assert.equal(sailingHero.onBoat, true, 'hero should board the boat');
assert.equal(map.tiles[sailingHero.y][sailingHero.x], 'WATER');
for (let i = 1; i < sailingPath.length; i++) {
  assert.ok(Math.abs(sailingPath[i].x - sailingPath[i - 1].x)
    + Math.abs(sailingPath[i].y - sailingPath[i - 1].y) === 1, 'boat moves cell by cell');
}
for (let i = 0; i < 16 && sailingHero.onBoat; i++) d.computeTurnPlan({ recordMoves: false, events: [] });
assert.equal(sailingHero.x, village.x, 'hero should reach the destination port');
assert.equal(sailingHero.y, village.y);
assert.equal(sailingHero.onBoat, false, 'hero should disembark');
game.season = 'winter'; village.cartTimer = 0; village.storedFood = 10;
village.coinRate = 0; village.storedCoin = 0;
const actorsBefore = game.actors.length;
d.tickVillages([]);
assert.equal(game.actors.length, actorsBefore, 'sea cargo should wait for summer');
assert.equal(village.storedCoin, 2, 'village port adds two coins to its store');
game.population = 0;
const castleCoinBefore = game.coin;
d.economyTick([]);
assert.equal(game.coin - castleCoinBefore, 2, 'keep port adds two treasury coins');

// An inland keep may receive a remote boat through a coastal road village.
context.window.__lorTest.newGame(587033999, { manual: true });
const relay = d.game, relayMap = d.map;
const coastY = relay.castle.y, coastX = relay.castle.x;
const sign = coastX < cols / 2 ? 1 : -1;
const localX = coastX + sign * 8, remoteX = coastX + sign * 40;
for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) relayMap.tiles[y][x] = 'PLAINS';
for (let x = 1; x < cols - 1; x++) relayMap.tiles[coastY - 1][x] = 'WATER';
relay.castle.y += 3;
relayMap.tiles[relay.castle.y][coastX] = 'CASTLE';
relay.discovered.fill(1); relay.discoveredTotal = cols * rows;
relay.coin = 1000; relay.food = 1000;
relay.actors.length = 0; relay.hostiles.length = 0; relay.lairs.length = 0;
relay.caches = d.makeWorldCaches(relayMap, relay.castle);
relay.pathScratch = d.makePathScratch();
const local = d.foundVillageAt(localX, coastY, 'fields').village;
const distantPreview = d.canFoundVillageAt(remoteX, coastY);
assert.equal(distantPreview.seaLinked, true);
assert.equal(distantPreview.anchorId, local.id);
const distant = d.foundVillageAt(remoteX, coastY, 'fields').village;
distant.storedFood = 9; distant.storedCoin = 7;
d.spawnVillageCart(distant, []);
const relayBoat = relay.actors[relay.actors.length - 1];
const relayPath = d.findPath(relayBoat, local);
relayBoat.goal = { type: 'deliver', target: { x: local.x, y: local.y }, path: relayPath.slice(1) };
for (let i = 0; i < 12 && relayBoat.alive; i++) d.computeTurnPlan({ recordMoves: false, events: [] });
assert.equal(relayBoat.delivered, true);
assert.equal(local.storedFood, 9);
assert.equal(local.storedCoin, 7);
d.spawnVillageCart(local, []);
const relayCart = relay.actors[relay.actors.length - 1];
assert.equal(relayCart.boat, false);
assert.ok(relayCart.originVillageIds.includes(distant.id));
const roadPath = d.findPath(relayCart, relay.castle);
relayCart.goal = { type: 'deliver', target: { x: relay.castle.x, y: relay.castle.y }, path: roadPath.slice(1) };
const relayFoodBefore = relay.food;
for (let i = 0; i < 8 && relayCart.alive; i++) d.computeTurnPlan({ recordMoves: false, events: [] });
assert.equal(relayCart.delivered, true);
assert.equal(relay.food - relayFoodBefore, 9);
const child = d.foundVillageAt(remoteX + sign * 8, coastY, 'fields').village;
assert.equal(child.seaLinked, false);
assert.equal(child.anchorId, distant.id);
child.storedFood = 5; child.storedCoin = 3;
d.spawnVillageCart(child, []);
const childCart = relay.actors[relay.actors.length - 1];
assert.equal(childCart.deliveryId, distant.id, 'road cargo must stop at the sea-linked parent');
const childPath = d.findPath(childCart, distant);
childCart.goal = { type: 'deliver', target: { x: distant.x, y: distant.y }, path: childPath.slice(1) };
for (let i = 0; i < 8 && childCart.alive; i++) d.computeTurnPlan({ recordMoves: false, events: [] });
assert.equal(childCart.delivered, true);
assert.equal(distant.storedFood, 5);
assert.equal(distant.storedCoin, 3);
d.spawnVillageCart(distant, []);
const childBoat = relay.actors[relay.actors.length - 1];
assert.ok(childBoat.originVillageIds.includes(child.id));
const childBoatPath = d.findPath(childBoat, local);
childBoat.goal = { type: 'deliver', target: { x: local.x, y: local.y }, path: childBoatPath.slice(1) };
for (let i = 0; i < 12 && childBoat.alive; i++) d.computeTurnPlan({ recordMoves: false, events: [] });
assert.equal(childBoat.delivered, true);
d.spawnVillageCart(local, []);
const finalCart = relay.actors[relay.actors.length - 1];
assert.ok(finalCart.originVillageIds.includes(child.id));
assert.equal(finalCart.originVillageIds.includes(local.id), false, 'empty relay villages are not cargo origins');
const finalPath = d.findPath(finalCart, relay.castle);
finalCart.goal = { type: 'deliver', target: { x: relay.castle.x, y: relay.castle.y }, path: finalPath.slice(1) };
const finalFoodBefore = relay.food;
for (let i = 0; i < 8 && finalCart.alive; i++) d.computeTurnPlan({ recordMoves: false, events: [] });
assert.equal(finalCart.delivered, true);
assert.equal(relay.food - finalFoodBefore, 5);
assert.equal(child.lastFoodDeliveryTurn, relay.turn, 'Steward should recognize food that arrived through the sea relay');
for (let i = 0; i < 6; i++) d.stewardUpgradeVillages();
assert.ok(local.built.includes('port') && distant.built.includes('port'),
  'Steward should pair ports at connected coastal villages');
d.destroyVillage(local, []);
assert.equal(distant.anchorId, null, 'sea village must detach when its only valid landing falls');
const replacement = d.foundVillageAt(localX, coastY, 'fields').village;
d.tickVillages([]);
assert.equal(distant.anchorId, replacement.id, 'sea village should reconnect to a new landing');

// The Steward considers a far revealed shore when no local site is suitable.
context.window.__lorTest.newGame(587033999, { manual: true });
const stewardGame = d.game, stewardMap = d.map;
const stewardX = stewardGame.castle.x, stewardY = stewardGame.castle.y;
const farX = stewardX < cols / 2 ? stewardX + 35 : stewardX - 35;
for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) stewardMap.tiles[y][x] = 'MOUNTAIN';
for (let x = 1; x < cols - 1; x++) stewardMap.tiles[stewardY - 1][x] = 'WATER';
stewardMap.tiles[stewardY][stewardX] = 'CASTLE';
stewardMap.tiles[stewardY][farX] = 'SHORE';
stewardGame.discovered.fill(1); stewardGame.discoveredTotal = cols * rows;
stewardGame.coin = 1000; stewardGame.food = 1000; stewardGame.turn = 20;
stewardGame.actors.length = 0; stewardGame.hostiles.length = 0; stewardGame.lairs.length = 0;
stewardGame.caches = d.makeWorldCaches(stewardMap, stewardGame.castle);
stewardGame.pathScratch = d.makePathScratch();
assert.equal(d.canFoundVillageAt(farX, stewardY).seaLinked, true);
d.stewardFoundVillage({ village: { max: 4 } });
assert.equal(stewardGame.villages.length, 1, 'Steward should settle the revealed far shore');
assert.equal(stewardGame.villages[0].seaLinked, true);

console.log('Coastal founding, boat relay, port income/travel, and winter hold: OK');
