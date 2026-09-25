#!/usr/bin/env node
// Paired Free Play runs for the hero strategy and purse/XP economy.
import { loadSimulationApi } from './sim-runtime.mjs';

const defaultPolicies = ['balanced', 'heroes', 'heroesGuarded', 'heroesFood', 'heroesGear', 'heroesLean'];
const policyArg = process.argv.indexOf('--policies');
const policies = policyArg < 0 ? defaultPolicies : process.argv[policyArg + 1].split(',');
const roles = ['ranger', 'rogue', 'fighter', 'monster', 'monk'];
const games = Math.max(1, Number(process.argv[process.argv.indexOf('--games') + 1]) || 30);
const turns = Math.max(1, Number(process.argv[process.argv.indexOf('--turns') + 1]) || 150);
const seed0 = (Number(process.argv[process.argv.indexOf('--seed') + 1]) || 1592594996) >>> 0;
const checkpoints = [25, 50, 75, 100, 150].filter(turn => turn <= turns);
const seeds = Array.from({ length: games }, (_, i) => ((seed0 + Math.imul(i, 2654435761)) >>> 0) || 1);
const api = loadSimulationApi();

function finance(game) {
  let alivePurse = 0, deadPurse = 0, aliveHeroes = 0, geared = 0, level2 = 0, level3 = 0;
  let canBuyGear = 0, gearBlockedByShop = 0, gearBlockedByTravel = 0;
  const byRole = Object.fromEntries(roles.map(role => [role, { alive: 0, level2: 0, level3: 0, purse: 0, gear: 0 }]));
  const forge = game.built.includes('blacksmith');
  for (const a of game.actors) {
    if (!a.hero || a.ownerId !== game.id) continue;
    if (!a.alive) { deadPurse += a.purse || 0; continue; }
    aliveHeroes++;
    alivePurse += a.purse || 0;
    geared += (a.equip || 0) > 0 ? 1 : 0;
    level2 += a.level >= 2 ? 1 : 0;
    level3 += a.level >= 3 ? 1 : 0;
    const role = byRole[a.role];
    if (role) {
      role.alive++;
      role.level2 += a.level >= 2 ? 1 : 0;
      role.level3 += a.level >= 3 ? 1 : 0;
      role.purse += a.purse || 0;
      role.gear += a.equip || 0;
    }
    if ((a.equip || 0) >= 5 || (a.purse || 0) < 40 * ((a.equip || 0) + 1)) continue;
    canBuyGear++;
    if (!forge) gearBlockedByShop++;
    else if (a.x !== game.castle.x || a.y !== game.castle.y) gearBlockedByTravel++;
  }
  const income = game.wildGold + game.heroBountyPaid + game.heroExtortFromVillage;
  const spent = game.heroShopSpent + game.heroRestSpent;
  const balanceError = income - spent - alivePurse - deadPurse;
  if (balanceError) throw new Error(`Hero purse accounting differs by ${balanceError} on turn ${game.turn}`);
  return {
    pop: game.population, coin: game.coin, food: Math.floor(game.food), tier: game.castleTier,
    villages: game.villages.filter(v => v.alive).length,
    inns: game.villages.filter(v => v.alive && v.built.includes('inn')).length,
    built: game.built.slice(),
    hired: game.heroSeq, aliveHeroes, level2, level3, geared, byRole,
    alivePurse, deadPurse, canBuyGear, gearBlockedByShop, gearBlockedByTravel,
    wildGold: game.wildGold, bountyPaid: game.heroBountyPaid,
    extortFromVillage: game.heroExtortFromVillage, income,
    shopSpent: game.heroShopSpent, restSpent: game.heroRestSpent, spent,
    shopTax: game.shopIncome, keepRestTax: game.restIncome,
    villageRestTax: game.villageRestIncome, restTax: game.restIncome + game.villageRestIncome,
    tax: game.taxCollected, balanceError,
  };
}

function run(seed, policy) {
  api.newGame(seed, { policy });
  const game = api._goalProbeGame();
  const seen = new Map();
  const at = {};
  let played = 0;
  for (let step = 0; step < turns; step++) {
    const result = api.stepTurn();
    if (!result) break;
    played++;
    for (const a of game.actors) {
      if (!a.hero || a.ownerId !== game.id) continue;
      let rec = seen.get(a.heroUid);
      if (!rec) {
        rec = { role: a.role, firstSeen: played, level2: null, level3: null,
          firstGear: null, dead: null, purseAtDeath: null, gearAtDeath: null, maxLevel: 1 };
        seen.set(a.heroUid, rec);
      }
      if (a.level > rec.maxLevel) rec.maxLevel = a.level;
      if (a.level >= 2 && rec.level2 == null) rec.level2 = played;
      if (a.level >= 3 && rec.level3 == null) rec.level3 = played;
      if (a.equip >= 1 && rec.firstGear == null) rec.firstGear = played;
      if (!a.alive && rec.dead == null) {
        rec.dead = played;
        rec.purseAtDeath = a.purse || 0;
        rec.gearAtDeath = a.equip || 0;
      }
    }
    if (checkpoints.includes(played)) at[played] = finance(game);
    if (result.snapshot.gameOver) break;
  }
  const roster = [...seen.values()];
  const final = finance(game);
  return {
    seed, policy, played, banditKeep: game.lairs.some(l => l.type === 'bandit'),
    at, final, roster,
    heroDeaths: game.simStats.heroDeaths, deathLevels: game.simStats.heroDeathLevels,
    ruins: game.exploredRuins.size, lairsCleared: game.lairsCleared,
  };
}

const runs = [];
for (const policy of policies) {
  for (const seed of seeds) runs.push(run(seed, policy));
  process.stderr.write(`${policy}: ${games} runs complete\n`);
}
const result = { rules: { games, turns, seed0, checkpoints, policies, seeds }, runs };
process.stdout.write(JSON.stringify(result) + '\n');
