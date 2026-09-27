#!/usr/bin/env node
// Paired, browser-free ablation of ranger companion durability.
import assert from 'node:assert/strict';
import { loadSimulationApi } from './sim-runtime.mjs';

const argValue = (flag, fallback) => {
  const i = process.argv.indexOf(flag);
  return i < 0 ? fallback : process.argv[i + 1];
};
const games = Number(argValue('--games', 30)) || 30;
const turns = Number(argValue('--turns', 150)) || 150;
const policies = argValue('--policies', 'rangers,supportR').split(',');
const requested = argValue('--variants', 'current,hp2,regen6,hp2_regen6,no_taming').split(',');
const mapType = argValue('--map-type', 'balanced');
const seed0 = 1592594996;
const seeds = Array.from({ length: games }, (_, i) => ((seed0 + Math.imul(i, 2654435761)) >>> 0) || 1);
const variants = [
  { id: 'current' },
  { id: 'hp2', hp: 2 },
  { id: 'hp2_5', hp: 2.5 },
  { id: 'hp2_75', hp: 2.75 },
  { id: 'hp3', hp: 3 },
  { id: 'regen6', regen: 0.06 },
  { id: 'regen0', regen: 0 },
  { id: 'hp2_regen6', hp: 2, regen: 0.06 },
  { id: 'no_level_heal', levelHeal: false },
  { id: 'no_taming', noTaming: true },
].filter(variant => requested.includes(variant.id));
assert.equal(variants.length, requested.length, 'unknown variant requested');

function transformedSource(variant) {
  return source => {
    let result = source;
    for (const [oldLine, newLine] of [
      ['const TAME_HP_MUL = 3.5;', variant.hp == null ? null : `const TAME_HP_MUL = ${variant.hp};`],
      ['const TAME_REGEN_FRAC = 0.12;', variant.regen == null ? null : `const TAME_REGEN_FRAC = ${variant.regen};`],
    ]) {
      if (!newLine) continue;
      assert.ok(result.includes(oldLine), `missing source marker: ${oldLine}`);
      result = result.replace(oldLine, newLine);
    }
    if (variant.noTaming) {
      const tameDefs = /const TAME_DEFS = \{\n    boar: \{ minLevel: 2 \},\n    wolf: \{ minLevel: 3 \},\n    bear: \{ minLevel: 4 \},\n  \};/;
      assert.ok(tameDefs.test(result), 'missing beast taming definitions');
      result = result.replace(tameDefs, 'const TAME_DEFS = {};');
    }
    if (variant.levelHeal === false) {
      const oldBlock = 'beast.maxHp = Math.round(beast.maxHp * 1.35);\n      beast.hp = beast.maxHp;';
      const newBlock = 'const oldMaxHp = beast.maxHp;\n      beast.maxHp = Math.round(oldMaxHp * 1.35);\n      beast.hp = Math.min(beast.maxHp, beast.hp + beast.maxHp - oldMaxHp);';
      assert.ok(result.includes(oldBlock), 'missing beast level-heal marker');
      result = result.replace(oldBlock, newBlock);
    }
    return result;
  };
}

function run(api, seed, policy) {
  api.newGame(seed, { policy, mapType, render: false });
  const game = api._goalProbeGame();
  const pets = new Map();
  const rangers = new Map();
  let petKills = 0, hostilesKilled = 0, fights = 0, petTurns = 0;
  let snapshot = null;
  for (let n = 0; n < turns; n++) {
    const result = api.stepTurn();
    if (!result) break;
    snapshot = result.snapshot;
    fights += result.combats;
    for (const actor of game.actors) {
      if (actor.role === 'ranger' && actor.hero && actor.ownerId === game.id)
        rangers.set(actor.heroUid, { alive: actor.alive, level: actor.level });
      if (!actor.tamed) continue;
      let rec = pets.get(actor.id);
      if (!rec) {
        rec = { kind: actor.beastKind, birth: game.turn, liveTurns: 0, maxLevel: actor.level,
          hpAtFirstSeen: actor.maxHp, alive: actor.alive };
        pets.set(actor.id, rec);
      }
      rec.alive = actor.alive;
      rec.seenTurn = game.turn;
      if (actor.level > rec.maxLevel) rec.maxLevel = actor.level;
      if (actor.alive) { rec.liveTurns++; petTurns++; }
    }
    for (const rec of pets.values()) if (rec.seenTurn !== game.turn) rec.alive = false;
    for (const event of result.events) {
      if (/ killed /.test(event)) {
        hostilesKilled++;
        for (const pet of game.actors) {
          if (pet.tamed && event.startsWith(`${pet.name} killed `)) { petKills++; break; }
        }
      }
    }
    if (snapshot.gameOver) break;
  }
  snapshot ||= api.snapshot();
  const petRecords = [...pets.values()];
  const rangerRecords = [...rangers.values()];
  return {
    seed, played: game.turn, collapsed: snapshot.gameOver && snapshot.outcome !== 'victory' ? 1 : 0,
    pop: snapshot.population, food: snapshot.food, coin: snapshot.coin,
    discoveredPct: snapshot.discoveredPct, lairs: snapshot.lairsCleared,
    villages: snapshot.villagesAlive, wildGold: snapshot.wildGold,
    shopIncome: snapshot.shopIncome, hostileKills: hostilesKilled, fights,
    rangerHired: rangerRecords.length, rangerDead: rangerRecords.filter(r => !r.alive).length,
    rangerAlive: rangerRecords.filter(r => r.alive).length,
    rangerLevel2: rangerRecords.filter(r => r.alive && r.level >= 2).length,
    rangerLevel3: rangerRecords.filter(r => r.alive && r.level >= 3).length,
    tamings: game.simStats.tamings, petSeen: pets.size,
    petAlive: petRecords.filter(p => p.alive).length, petTurns,
    petDeaths: petRecords.filter(p => !p.alive).length,
    petMeanLife: pets.size ? petTurns / pets.size : 0,
    petLevelUps: game.simStats.beastLevelUps,
    petKills, petByKind: Object.fromEntries(['boar', 'wolf', 'bear'].map(kind =>
      [kind, petRecords.filter(p => p.kind === kind).length])),
  };
}

function summary(runs) {
  const keys = Object.keys(runs[0]).filter(key => key !== 'seed' && key !== 'petByKind');
  const out = { games: runs.length };
  for (const key of keys) out[key] = runs.reduce((sum, run) => sum + run[key], 0) / runs.length;
  out.petByKind = Object.fromEntries(['boar', 'wolf', 'bear'].map(kind =>
    [kind, runs.reduce((sum, run) => sum + run.petByKind[kind], 0)]));
  return out;
}

const results = [];
for (const variant of variants) {
  const api = loadSimulationApi({ transformSource: transformedSource(variant) });
  for (const policy of policies) {
    const runs = seeds.map(seed => run(api, seed, policy));
    const row = { variant: variant.id, policy, summary: summary(runs), runs };
    results.push(row);
    process.stderr.write(`${variant.id} ${policy}: ${games} games complete\n`);
  }
}
process.stdout.write(JSON.stringify({ games, turns, seed0, seeds, mapType, results }) + '\n');
