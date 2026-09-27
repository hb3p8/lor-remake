#!/usr/bin/env node
import assert from 'node:assert/strict';
import { loadSimulationApi } from './sim-runtime.mjs';

const api = loadSimulationApi();
api.newGame(3509986198, { manual: true, mapType: 'forest-swamp', render: false });
const game = api._goalProbeGame();
const map = api._map();
assert.equal(map.seed, 3509986198);
game.built.push('rangers');
game.coin = 1000;
assert.equal(api.manualHire('ranger'), true);
const ranger = game.actors.find(a => a.role === 'ranger');
ranger.x = 60;
ranger.y = 38;

const troll = {
  ...game.hostiles[0], id: 'route-troll', name: 'Troll', kind: 'troll',
  x: 63, y: 40, alive: true, hp: 45, maxHp: 45, ac: 14, atk: 5,
  dmg: { n: 1, d: 12, mod: 4 },
};
game.hostiles.push(troll);
const cols = map.tiles[0].length;
game.visible[troll.y * cols + troll.x] = 1;

// A previously safe trip home becomes unsafe when a troll crosses its path.
ranger.goal = {
  type: 'shop', target: { ...game.castle }, path: [{ x: 60, y: 39 }, { x: 60, y: 40 }],
  utility: 120, committedAtTurn: game.turn, bountyRevision: game.bountyRevision,
};
let goal = api._goalProbeChoose(ranger);
assert.equal(goal?.type, 'shop', 'keep trip remains available through a safe detour');
assert.ok(goal.path.length > 2, 'route was rebuilt');
assert.ok(goal.path.every(cell => Math.max(Math.abs(cell.x - troll.x), Math.abs(cell.y - troll.y)) > 3),
  'new path stays outside the stronger troll’s reach');

// When a ruin itself is within the danger zone, postpone that delve.
troll.x = 69;
troll.y = 28;
game.visible[troll.y * cols + troll.x] = 1;
ranger.goal = {
  type: 'delve', target: { x: 70, y: 28 }, path: [{ x: 69, y: 29 }, { x: 70, y: 28 }],
  utility: 90, committedAtTurn: game.turn, bountyRevision: game.bountyRevision,
};
goal = api._goalProbeChoose(ranger);
assert.ok(!goal || goal.type !== 'delve' || goal.target.x !== 70 || goal.target.y !== 28,
  'unsafe ruin is deferred until a safe route exists');

console.log('Ranger detours around a visible troll and defers an unsafe ruin.');
