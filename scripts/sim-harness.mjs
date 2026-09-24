#!/usr/bin/env node
import assert from 'node:assert/strict';

import { loadSimulationApi } from './sim-runtime.mjs';
const ALL_POLICIES = ['economy', 'defense', 'heroes', 'rangers', 'rogues', 'balanced', 'support', 'support0', 'supportR'];

function parseArgs(argv) {
  const options = { games: 10, turns: 100, seed: 0x5eed1234, json: false, policy: 'balanced', compare: false, probeGoals: false };
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--json') {
      options.json = true;
    } else if (arg === '--probe-goals') {
      options.probeGoals = true;
    } else if (arg === '--compare') {
      options.compare = true;
    } else if (arg === '--games') {
      options.games = Math.max(1, Number(argv[++i]) | 0);
    } else if (arg === '--turns') {
      options.turns = Math.max(1, Number(argv[++i]) | 0);
    } else if (arg === '--seed') {
      options.seed = Number(argv[++i]) >>> 0;
    } else if (arg === '--policy') {
      options.policy = argv[++i];
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return options;
}

function makeCheckpoints(turns) {
  const base = [10, 25, 50, 100, turns];
  const seen = new Set();
  const result = [];
  for (let i = 0; i < base.length; i++) {
    const turn = Math.min(turns, base[i]);
    if (turn > 0 && !seen.has(turn)) {
      seen.add(turn);
      result.push(turn);
    }
  }
  result.sort((a, b) => a - b);
  return result;
}

function average(values) {
  if (!values.length) return null;
  let sum = 0;
  for (let i = 0; i < values.length; i++) sum += values[i];
  return sum / values.length;
}

function runGame(api, seed, turns, checkpoints, policy) {
  let snapshot = api.newGame(seed, { render: false, policy });
  api.resetStats();
  const startedAt = performance.now();
  const popAt = Object.create(null);
  const foodAt = Object.create(null);
  const coinAt = Object.create(null);
  const tierAt = Object.create(null);
  const builtAt = Object.create(null);
  let combatRounds = 0;
  let hostileKills = 0;
  let guardsFallen = 0;
  let friendlyDeaths = 0;
  let winters = 0;
  let winterTurns = 0;
  let minPop = snapshot.population;
  let turnsPlayed = 0;
  let collapseTurn = null;

  for (let step = 0; step < turns; step++) {
    const result = api.stepTurn();
    if (!result) break;
    turnsPlayed++;
    snapshot = result.snapshot;
    combatRounds += result.combats;
    if (snapshot.population < minPop) minPop = snapshot.population;
    if (snapshot.season === 'winter') winterTurns++;
    for (let i = 0; i < result.events.length; i++) {
      if (/Winter closes in/i.test(result.events[i])) winters++;
      if (/died fighting/i.test(result.events[i])) friendlyDeaths++;
      if (/killed/i.test(result.events[i])) hostileKills++;
      if (/guard fell/i.test(result.events[i])) guardsFallen++;
    }
    for (let i = 0; i < checkpoints.length; i++) {
      const checkpoint = checkpoints[i];
      if (snapshot.turn - 1 === checkpoint) {
        popAt[checkpoint] = snapshot.population;
        foodAt[checkpoint] = snapshot.food;
        coinAt[checkpoint] = snapshot.coin;
        tierAt[checkpoint] = snapshot.castleTier;
        builtAt[checkpoint] = snapshot.built.length;
      }
    }
    if (snapshot.gameOver) {
      collapseTurn = turnsPlayed;
      break;
    }
  }
  const elapsedMs = performance.now() - startedAt;
  snapshot = api.snapshot();

  return {
    seed,
    finalTurn: snapshot.turn,
    turnsPlayed,
    collapseTurn,
    popAt,
    foodAt,
    coinAt,
    tierAt,
    builtAt,
    finalPopulation: snapshot.population,
    finalHousing: snapshot.housing,
    finalTier: snapshot.castleTier,
    finalCastleName: snapshot.castleName,
    finalBuilt: snapshot.built,
    finalFood: snapshot.food,
    finalCoin: snapshot.coin,
    finalGuards: snapshot.guards,
    raidsLost: snapshot.raidsLost,
    waves: snapshot.waveNum,
    lairsCleared: snapshot.lairsCleared || 0,
    lairsActive: snapshot.lairsActive || 0,
    lairsTotal: snapshot.lairsTotal || 0,
    wildGold: snapshot.wildGold || 0,
    taxCollected: snapshot.taxCollected || 0,
    shopIncome: snapshot.shopIncome || 0,
    restIncome: snapshot.restIncome || 0,
    villageRestIncome: snapshot.villageRestIncome || 0,
    heroRestSpent: snapshot.heroRestSpent || 0,
    heroGold: snapshot.heroGold || 0,
    avgEquipTier: snapshot.avgEquipTier || 0,
    ruinsExplored: snapshot.ruinsExplored || 0,
    heroes: snapshot.heroes,
    tamings: snapshot.simStats ? (snapshot.simStats.tamings || 0) : 0,
    beastLevelUps: snapshot.simStats ? (snapshot.simStats.beastLevelUps || 0) : 0,
    potionsBought: snapshot.simStats ? (snapshot.simStats.potionsBought || 0) : 0,
    potionsQuaffed: snapshot.simStats ? (snapshot.simStats.potionsQuaffed || 0) : 0,
    heroesHired: snapshot.heroesHired || 0,
    firstHeroTurn: snapshot.firstHeroTurn,
    heroDeaths: snapshot.simStats ? (snapshot.simStats.heroDeaths || 0) : 0,
    heroDeathLevels: snapshot.simStats ? (snapshot.simStats.heroDeathLevels || {}) : {},
    huntsFilled: snapshot.simStats ? (snapshot.simStats.huntsFilled || 0) : 0,
    huntFood: snapshot.simStats ? (snapshot.simStats.huntFood || 0) : 0,
    extortions: snapshot.simStats ? (snapshot.simStats.extortions || 0) : 0,
    stealths: snapshot.simStats ? (snapshot.simStats.stealths || 0) : 0,
    monkHeals: snapshot.simStats ? (snapshot.simStats.monkHeals || 0) : 0,
    monkHealHp: snapshot.simStats ? (snapshot.simStats.monkHealHp || 0) : 0,
    monkFees: snapshot.simStats ? (snapshot.simStats.monkFees || 0) : 0,
    monkSlows: snapshot.simStats ? (snapshot.simStats.monkSlows || 0) : 0,
    monksHired: snapshot.simStats ? (snapshot.simStats.monksHired || 0) : 0,
    monkLevelUps: snapshot.simStats ? (snapshot.simStats.monkLevelUps || 0) : 0,
    ruinGearFinds: snapshot.simStats ? (snapshot.simStats.ruinGearFinds || 0) : 0,
    ruinSkeletons: snapshot.simStats ? (snapshot.simStats.ruinSkeletons || 0) : 0,
    patrolsFilled: snapshot.simStats ? (snapshot.simStats.patrolsFilled || 0) : 0,
    militiaBought: snapshot.simStats ? (snapshot.simStats.militiaBought || 0) : 0,
    militiaBlocks: snapshot.simStats ? (snapshot.simStats.militiaBlocks || 0) : 0,
    militiaKills: snapshot.simStats ? (snapshot.simStats.militiaKills || 0) : 0,
    militiaDeaths: snapshot.simStats ? (snapshot.simStats.militiaDeaths || 0) : 0,
    militiaExpired: snapshot.simStats ? (snapshot.simStats.militiaExpired || 0) : 0,
    goalSwitches: snapshot.simStats ? (snapshot.simStats.goalSwitches || 0) : 0,
    goalInvalidations: snapshot.simStats ? (snapshot.simStats.goalInvalidations || 0) : 0,
    goalCalls: snapshot.simStats ? (snapshot.simStats.goalCalls || 0) : 0,
    pathCalls: snapshot.simStats ? (snapshot.simStats.pathCalls || 0) : 0,
    vikingRaids: snapshot.simStats ? (snapshot.simStats.vikingRaids || 0) : 0,
    vikingCoinStolen: snapshot.simStats ? (snapshot.simStats.vikingCoinStolen || 0) : 0,
    vikingCoinRecovered: snapshot.simStats ? (snapshot.simStats.vikingCoinRecovered || 0) : 0,
    villagesAlive: snapshot.villagesAlive || 0,
    villagesFounded: snapshot.villagesFounded || 0,
    firstVillageTurn: snapshot.firstVillageTurn,
    firstVillageSpec: snapshot.firstVillageSpec,
    firstVillageRich: snapshot.firstVillageRich,
    firstCartDeliveryTurn: snapshot.firstCartDeliveryTurn,
    richSitesDiscovered: snapshot.richSitesDiscovered || 0,
    villagesDestroyed: snapshot.villagesDestroyed || 0,
    cartsSent: snapshot.cartsSent || 0,
    cartsDelivered: snapshot.cartsDelivered || 0,
    cartsLost: snapshot.cartsLost || 0,
    villageCoinDelivered: snapshot.villageCoinDelivered || 0,
    villageFoodDelivered: snapshot.villageFoodDelivered || 0,
    beastsAlive: snapshot.beasts ? snapshot.beasts.alive : 0,
    beastAvgLevel: snapshot.beasts ? snapshot.beasts.avgLevel : 0,
    hostilesAlive: snapshot.hostilesAlive,
    minPop,
    collapsed: minPop <= 0 ? 1 : 0,
    friendlyDeaths,
    winters,
    winterShare: turnsPlayed ? winterTurns / turnsPlayed : 0,
    combatRounds,
    hostileKills,
    guardsFallen,
    elapsedMs,
    simStats: snapshot.simStats,
  };
}

function summarize(runs, checkpoints) {
  let totalCombatRounds = 0;
  let totalHostileKills = 0;
  let totalElapsedMs = 0;
  const simStats = {
    turns: 0, turnMs: 0, goalCalls: 0, goalMs: 0,
    pathCalls: 0, pathMs: 0, candidateCells: 0, candidateCount: 0,
    goalRetained: 0, goalArrivals: 0, goalBlocked: 0, goalTargetGone: 0, goalABASwitches: 0,
    goalTargetRefreshes: 0, bountyEventChecks: 0, bountyEventSwitches: 0,
  };
  const pop = Object.create(null);
  const food = Object.create(null);
  const coin = Object.create(null);
  const tier = Object.create(null);
  const built = Object.create(null);
  const reached = Object.create(null);
  for (const c of checkpoints) { pop[c] = []; food[c] = []; coin[c] = []; tier[c] = []; built[c] = []; reached[c] = 0; }

  for (const run of runs) {
    totalCombatRounds += run.combatRounds;
    totalHostileKills += run.hostileKills;
    totalElapsedMs += run.elapsedMs;
    if (run.simStats) {
      for (const k of Object.keys(simStats)) simStats[k] += run.simStats[k] || 0;
    }
    for (const c of checkpoints) {
      if (run.popAt[c] === undefined) continue;
      reached[c]++;
      pop[c].push(run.popAt[c]);
      food[c].push(run.foodAt[c]);
      coin[c].push(run.coinAt[c]);
      tier[c].push(run.tierAt[c] + 1);
      built[c].push(run.builtAt[c]);
    }
  }

  const avgAt = src => { const o = Object.create(null); for (const c of checkpoints) o[c] = average(src[c]); return o; };

  return {
    games: runs.length,
    turns: checkpoints[checkpoints.length - 1] || 0,
    reachedAt: reached,
    avgTurnsPlayed: average(runs.map(r => r.turnsPlayed)),
    popAt: avgAt(pop),
    foodAt: avgAt(food),
    coinAt: avgAt(coin),
    tierAt: avgAt(tier),
    builtAt: avgAt(built),
    avgFinalPopulation: average(runs.map(r => r.finalPopulation)),
    avgFinalTier: average(runs.map(r => r.finalTier + 1)),
    avgFinalCoin: average(runs.map(r => r.finalCoin)),
    avgFinalBuilt: average(runs.map(r => r.finalBuilt.length)),
    avgCombatRounds: totalCombatRounds / runs.length,
    avgHostileKills: totalHostileKills / runs.length,
    avgFinalGuards: average(runs.map(r => r.finalGuards)),
    avgGuardsFallen: average(runs.map(r => r.guardsFallen)),
    avgRaidsLost: average(runs.map(r => r.raidsLost)),
    avgMinPop: average(runs.map(r => r.minPop)),
    collapseRate: average(runs.map(r => r.collapsed)),
    avgWinters: average(runs.map(r => r.winters)),
    avgWinterShare: average(runs.map(r => r.winterShare)),
    avgLairsCleared: average(runs.map(r => r.lairsCleared)),
    avgLairsActive: average(runs.map(r => r.lairsActive)),
    avgLairsTotal: average(runs.map(r => r.lairsTotal)),
    avgWildGold: average(runs.map(r => r.wildGold)),
    avgTaxCollected: average(runs.map(r => r.taxCollected)),
    avgShopIncome: average(runs.map(r => r.shopIncome)),
    avgRestIncome: average(runs.map(r => r.restIncome)),
    avgVillageRestIncome: average(runs.map(r => r.villageRestIncome)),
    avgHeroRestSpent: average(runs.map(r => r.heroRestSpent)),
    avgHeroGold: average(runs.map(r => r.heroGold)),
    avgEquipTier: average(runs.map(r => r.avgEquipTier)),
    avgRuinsExplored: average(runs.map(r => r.ruinsExplored)),
    avgRuinGearFinds: average(runs.map(r => r.ruinGearFinds)),
    avgRuinSkeletons: average(runs.map(r => r.ruinSkeletons)),
    avgPatrolsFilled: average(runs.map(r => r.patrolsFilled)),
    avgMilitiaBought: average(runs.map(r => r.militiaBought)),
    avgMilitiaBlocks: average(runs.map(r => r.militiaBlocks)),
    avgMilitiaKills: average(runs.map(r => r.militiaKills)),
    avgMilitiaDeaths: average(runs.map(r => r.militiaDeaths)),
    avgMilitiaExpired: average(runs.map(r => r.militiaExpired)),
    avgGoalSwitches: average(runs.map(r => r.goalSwitches)),
    avgGoalInvalidations: average(runs.map(r => r.goalInvalidations)),
    avgGoalCalls: average(runs.map(r => r.goalCalls)),
    avgPathCalls: average(runs.map(r => r.pathCalls)),
    goalLifecycle: {
      retained: simStats.goalRetained,
      arrivals: simStats.goalArrivals,
      blocked: simStats.goalBlocked,
      targetGone: simStats.goalTargetGone,
      targetRefreshes: simStats.goalTargetRefreshes,
      bountyChecks: simStats.bountyEventChecks,
      bountySwitches: simStats.bountyEventSwitches,
      abaSwitches: simStats.goalABASwitches,
    },
    avgVikingRaids: average(runs.map(r => r.vikingRaids)),
    avgVikingCoinStolen: average(runs.map(r => r.vikingCoinStolen)),
    avgVikingCoinRecovered: average(runs.map(r => r.vikingCoinRecovered)),
    avgTamings: average(runs.map(r => r.tamings)),
    avgBeastLevelUps: average(runs.map(r => r.beastLevelUps)),
    avgPotionsBought: average(runs.map(r => r.potionsBought)),
    avgPotionsQuaffed: average(runs.map(r => r.potionsQuaffed)),
    avgHuntsFilled: average(runs.map(r => r.huntsFilled)),
    avgHuntFood: average(runs.map(r => r.huntFood)),
    avgExtortions: average(runs.map(r => r.extortions)),
    avgStealths: average(runs.map(r => r.stealths)),
    avgMonkHeals: average(runs.map(r => r.monkHeals)),
    avgMonkHealHp: average(runs.map(r => r.monkHealHp)),
    avgMonkFees: average(runs.map(r => r.monkFees)),
    avgMonkSlows: average(runs.map(r => r.monkSlows)),
    avgMonksHired: average(runs.map(r => r.monksHired)),
    avgMonkLevelUps: average(runs.map(r => r.monkLevelUps)),
    avgHeroesHired: average(runs.map(r => r.heroesHired)),
    avgFirstHeroTurn: average(runs.filter(r => r.firstHeroTurn != null).map(r => r.firstHeroTurn)),
    avgHeroDeaths: average(runs.map(r => r.heroDeaths)),
    heroDeathRatio: (() => { const h = runs.reduce((s, r) => s + r.heroesHired, 0); const d = runs.reduce((s, r) => s + r.heroDeaths, 0); return h ? d / h : 0; })(),
    heroDeathByLevel: (() => { const o = {}; for (const r of runs) for (const [k, v] of Object.entries(r.heroDeathLevels)) o[k] = (o[k] || 0) + v; return o; })(),
    avgVillagesFounded: average(runs.map(r => r.villagesFounded)),
    avgFirstVillageTurn: average(runs.filter(r => r.firstVillageTurn != null).map(r => r.firstVillageTurn)),
    avgFirstCartDeliveryTurn: average(runs.filter(r => r.firstCartDeliveryTurn != null).map(r => r.firstCartDeliveryTurn)),
    avgRichSitesDiscovered: average(runs.map(r => r.richSitesDiscovered)),
    firstVillageSpecs: (() => { const counts = {}; for (const r of runs) if (r.firstVillageSpec) counts[r.firstVillageSpec] = (counts[r.firstVillageSpec] || 0) + 1; return counts; })(),
    firstVillageRichCount: runs.filter(r => r.firstVillageRich).length,
    avgVillagesAlive: average(runs.map(r => r.villagesAlive)),
    avgVillagesDestroyed: average(runs.map(r => r.villagesDestroyed)),
    avgCartsSent: average(runs.map(r => r.cartsSent)),
    avgCartsDelivered: average(runs.map(r => r.cartsDelivered)),
    avgCartsLost: average(runs.map(r => r.cartsLost)),
    avgVillageCoin: average(runs.map(r => r.villageCoinDelivered)),
    avgVillageFood: average(runs.map(r => r.villageFoodDelivered)),
    avgBeastsAlive: average(runs.map(r => r.beastsAlive)),
    avgBeastLevel: average(runs.filter(r => r.beastsAlive > 0).map(r => r.beastAvgLevel)),
    avgFriendlyDeaths: average(runs.map(r => r.friendlyDeaths)),
    avgHeroTotal: average(runs.map(r => r.heroes.ranger + r.heroes.rogue + r.heroes.fighter + r.heroes.monster + r.heroes.monk)),
    avgWaves: average(runs.map(r => r.waves)),
    avgHeroes: {
      ranger: average(runs.map(r => r.heroes.ranger)),
      rogue: average(runs.map(r => r.heroes.rogue)),
      fighter: average(runs.map(r => r.heroes.fighter)),
      monster: average(runs.map(r => r.heroes.monster)),
      monk: average(runs.map(r => r.heroes.monk)),
    },
    perf: {
      elapsedMs: totalElapsedMs,
      turnsPerSecond: simStats.turns ? simStats.turns / (totalElapsedMs / 1000) : 0,
      avgTurnMs: simStats.turns ? simStats.turnMs / simStats.turns : 0,
      avgGoalMs: simStats.goalCalls ? simStats.goalMs / simStats.goalCalls : 0,
      avgPathMs: simStats.pathCalls ? simStats.pathMs / simStats.pathCalls : 0,
      pathCallsPerTurn: simStats.turns ? simStats.pathCalls / simStats.turns : 0,
      goalCallsPerTurn: simStats.turns ? simStats.goalCalls / simStats.turns : 0,
      candidateCellsPerGoal: simStats.goalCalls ? simStats.candidateCells / simStats.goalCalls : 0,
      candidatesPerGoal: simStats.goalCalls ? simStats.candidateCount / simStats.goalCalls : 0,
    },
  };
}

function printSummary(summary, runs, checkpoints) {
  console.log(`Simulated ${summary.games} games x up to ${summary.turns} turns (avg played ${summary.avgTurnsPlayed.toFixed(1)})`);
  console.log('City economy (avg over games):');
  console.log(`  ${'turn'.padStart(5)} | ${'alive'.padStart(5)} ${'pop'.padStart(5)} ${'tier'.padStart(5)} ${'food'.padStart(6)} ${'coin'.padStart(6)} ${'bldgs'.padStart(6)}`);
  const fmt = (value, digits, width) => (value == null ? '—' : value.toFixed(digits)).padStart(width);
  for (const c of checkpoints) {
    console.log(`  ${('T' + c).padStart(5)} | ${String(summary.reachedAt[c]).padStart(5)} ${fmt(summary.popAt[c], 1, 5)} ${fmt(summary.tierAt[c], 1, 5)} ${fmt(summary.foodAt[c], 0, 6)} ${fmt(summary.coinAt[c], 0, 6)} ${fmt(summary.builtAt[c], 1, 6)}`);
  }
  console.log(`Final: pop ${summary.avgFinalPopulation.toFixed(1)}, tier ${summary.avgFinalTier.toFixed(1)}, coin ${summary.avgFinalCoin.toFixed(0)}, buildings ${summary.avgFinalBuilt.toFixed(1)}, guards ${summary.avgFinalGuards.toFixed(1)}`);
  console.log(`Defense: raid waves/game ${summary.avgWaves.toFixed(1)}, hostile kills/game ${summary.avgHostileKills.toFixed(1)}, combat exch/game ${summary.avgCombatRounds.toFixed(1)}, guards fallen/game ${summary.avgGuardsFallen.toFixed(2)}, friendly deaths/game ${summary.avgFriendlyDeaths.toFixed(1)}, pop lost to raids/game ${summary.avgRaidsLost.toFixed(2)}`);
  console.log(`Stability: min pop ${summary.avgMinPop.toFixed(1)}, collapse rate ${(summary.collapseRate * 100).toFixed(0)}%`);
  console.log(`Seasons: winters/game ${summary.avgWinters.toFixed(1)}, time in winter ${(summary.avgWinterShare * 100).toFixed(0)}%`);
  console.log(`Lairs: ${summary.avgLairsTotal.toFixed(1)}/map, cleared/game ${summary.avgLairsCleared.toFixed(1)}, still active at end ${summary.avgLairsActive.toFixed(1)}`);
  console.log(`Hero gold: wild minted/game ${summary.avgWildGold.toFixed(0)}, shop income/game ${summary.avgShopIncome.toFixed(0)}, unspent purses ${summary.avgHeroGold.toFixed(0)}, avg gear tier ${summary.avgEquipTier.toFixed(2)}, ruins delved ${summary.avgRuinsExplored.toFixed(1)}`);
  console.log(`Treasury sources: population tax/game ${summary.avgTaxCollected.toFixed(0)}, keep rest/game ${summary.avgRestIncome.toFixed(0)}, village rest tax stored/game ${summary.avgVillageRestIncome.toFixed(0)}, hero rest spending/game ${summary.avgHeroRestSpent.toFixed(0)}`);
  console.log(`Ruins: gear caches/game ${summary.avgRuinGearFinds.toFixed(2)}, skeletons roused/game ${summary.avgRuinSkeletons.toFixed(2)}`);
  console.log(`Potions: bought/game ${summary.avgPotionsBought.toFixed(1)}, quaffed/game ${summary.avgPotionsQuaffed.toFixed(1)}`);
  console.log(`Heroes: hired/game ${summary.avgHeroesHired.toFixed(1)}, deaths/game ${summary.avgHeroDeaths.toFixed(1)}, death ratio ${(summary.heroDeathRatio * 100).toFixed(0)}%, deaths by level ${JSON.stringify(summary.heroDeathByLevel)}`);
  console.log(`First hero: turn ${summary.avgFirstHeroTurn == null ? '—' : summary.avgFirstHeroTurn.toFixed(1)}`);
  const h = summary.avgHeroes;
  console.log(`Heroes (final avg): ranger ${h.ranger.toFixed(1)}, rogue ${h.rogue.toFixed(1)}, fighter ${h.fighter.toFixed(1)}, monster ${h.monster.toFixed(1)}, monk ${h.monk.toFixed(1)}`);
  console.log(`Monks: hired/game ${summary.avgMonksHired.toFixed(1)}, level-ups ${summary.avgMonkLevelUps.toFixed(1)}, heals ${summary.avgMonkHeals.toFixed(1)}, HP restored ${summary.avgMonkHealHp.toFixed(1)}, fees ${summary.avgMonkFees.toFixed(1)}, slows ${summary.avgMonkSlows.toFixed(1)}`);
  console.log(`Taming: tamed/game ${summary.avgTamings.toFixed(2)}, level-ups/game ${summary.avgBeastLevelUps.toFixed(2)}, beasts alive at end ${summary.avgBeastsAlive.toFixed(2)}, avg surviving level ${(summary.avgBeastLevel || 0).toFixed(2)}`);
  console.log(`Villages: founded/game ${summary.avgVillagesFounded.toFixed(2)}, alive at end ${summary.avgVillagesAlive.toFixed(2)}, destroyed/game ${summary.avgVillagesDestroyed.toFixed(2)}`);
  console.log(`First village: turn ${summary.avgFirstVillageTurn == null ? '—' : summary.avgFirstVillageTurn.toFixed(1)}, first cart delivered ${summary.avgFirstCartDeliveryTurn == null ? '—' : summary.avgFirstCartDeliveryTurn.toFixed(1)}, trade ${JSON.stringify(summary.firstVillageSpecs)}, rich first ${summary.firstVillageRichCount}/${summary.games}, rich sites found/game ${summary.avgRichSitesDiscovered.toFixed(1)}`);
  console.log(`Patrols: flags filled/game ${summary.avgPatrolsFilled.toFixed(2)}`);
  console.log(`Militia: hired/game ${summary.avgMilitiaBought.toFixed(2)}, kills ${summary.avgMilitiaKills.toFixed(2)}, blocked ${summary.avgMilitiaBlocks.toFixed(2)}, deaths ${summary.avgMilitiaDeaths.toFixed(2)}, expired ${summary.avgMilitiaExpired.toFixed(2)}`);
  console.log(`Goal AI: switches/game ${summary.avgGoalSwitches.toFixed(0)}, invalidations/game ${summary.avgGoalInvalidations.toFixed(0)}, goalCalls/game ${summary.avgGoalCalls.toFixed(0)}, pathCalls/game ${summary.avgPathCalls.toFixed(0)}`);
  const gl = summary.goalLifecycle;
  console.log(`  retained ${gl.retained}, arrived ${gl.arrivals}, blocked ${gl.blocked}, target gone ${gl.targetGone}, target refreshes ${gl.targetRefreshes}, bounty checks ${gl.bountyChecks}, bounty switches ${gl.bountySwitches}, A-B-A ${gl.abaSwitches}`);
  console.log(`Vikings: raids/game ${summary.avgVikingRaids.toFixed(2)}, coin stolen/game ${summary.avgVikingCoinStolen.toFixed(1)}, recovered ${summary.avgVikingCoinRecovered.toFixed(1)}`);
  console.log(`Carts: sent/game ${summary.avgCartsSent.toFixed(2)}, delivered ${summary.avgCartsDelivered.toFixed(2)}, lost ${summary.avgCartsLost.toFixed(2)}, coin delivered/game ${summary.avgVillageCoin.toFixed(0)}, food ${summary.avgVillageFood.toFixed(0)}`);
  console.log(`Hunts: filled/game ${summary.avgHuntsFilled.toFixed(2)}, hunt food/game ${summary.avgHuntFood.toFixed(0)}`);
  console.log(`Rogues: extortions/game ${summary.avgExtortions.toFixed(2)}, stealths/game ${summary.avgStealths.toFixed(2)}`);
  console.log('Performance:');
  console.log(`  turns/sec: ${summary.perf.turnsPerSecond.toFixed(1)}`);
  console.log(`  avg turn compute: ${summary.perf.avgTurnMs.toFixed(3)} ms`);
  console.log(`  avg goal selection: ${summary.perf.avgGoalMs.toFixed(3)} ms`);
  console.log(`  avg pathfind: ${summary.perf.avgPathMs.toFixed(3)} ms`);
  console.log(`  path calls/turn: ${summary.perf.pathCallsPerTurn.toFixed(2)}`);
  console.log(`  candidate cells/goal: ${summary.perf.candidateCellsPerGoal.toFixed(2)}`);
  console.log(`  candidates/goal: ${summary.perf.candidatesPerGoal.toFixed(2)}`);
  console.log('Seeds:');
  console.log(`  ${runs.map(run => run.seed).join(', ')}`);
}

function pad(s, n) { return String(s).padStart(n); }

// One comparison row per strategy: end state + how it fared under raids.
function printCompareHeader() {
  console.log(`${'policy'.padEnd(9)} ${pad('pop', 5)} ${pad('tier', 5)} ${pad('coin', 6)} ${pad('bldg', 5)} ${pad('heroes', 7)} ${pad('kills', 6)} ${pad('raidLost', 9)} ${pad('minPop', 7)} ${pad('collapse', 9)}`);
}
function printCompareRow(policy, s) {
  console.log(`${policy.padEnd(9)} ${pad(s.avgFinalPopulation.toFixed(1), 5)} ${pad(s.avgFinalTier.toFixed(1), 5)} ${pad(s.avgFinalCoin.toFixed(0), 6)} ${pad(s.avgFinalBuilt.toFixed(1), 5)} ${pad(s.avgHeroTotal.toFixed(1), 7)} ${pad(s.avgHostileKills.toFixed(0), 6)} ${pad(s.avgRaidsLost.toFixed(1), 9)} ${pad(s.avgMinPop.toFixed(1), 7)} ${pad((s.collapseRate * 100).toFixed(0) + '%', 9)}`);
}

function probeGoalEvents(api) {
  api.newGame(12345, { render: false });
  const game = api._goalProbeGame();
  const map = api._map();
  const cols = map.tiles[0].length;
  const castle = game.castle;
  const home = castle.y * cols + castle.x;
  const cells = [];
  for (let i = 0; i < game.caches.passable.length; i++) {
    const cell = game.caches.passable[i];
    const x = cell % cols, y = (cell / cols) | 0;
    const d = Math.abs(x - castle.x) + Math.abs(y - castle.y);
    if (game.caches.component[cell] === game.caches.component[home] && d >= 4 && d <= 10) cells.push({ x, y });
    if (cells.length >= 3) break;
  }
  assert.equal(cells.length, 3, 'probe needs three reachable cells near the castle');
  const actor = {
    id: 'probe-fighter', role: 'fighter', hero: true, alive: true,
    x: castle.x, y: castle.y, hp: 100, maxHp: 100, level: 1, steps: 5,
    dmg: { n: 1, d: 8, mod: 1 }, atk: 4, purse: 0, equip: 0, potions: 0,
  };
  const hostile = {
    id: 'probe-hostile', kind: 'bandit', name: 'Probe bandit', alive: true,
    x: cells[0].x, y: cells[0].y, hp: 10, maxHp: 10, atk: 4,
    dmg: { n: 1, d: 6, mod: 0 }, threat: 2,
  };
  game.hostiles.length = 0;
  game.hostiles.push(hostile);
  game.visible.fill(1);
  game.coin = 1000;
  game.turn = 10;
  actor.goal = {
    type: 'explore', target: { x: cells[2].x, y: cells[2].y },
    path: [cells[2]], utility: 999, reason: 'probe incumbent',
    committedAtTurn: 10, bountyRevision: game.bountyRevision,
  };
  api.postBounty('kill', hostile.id);
  const checksBefore = game.simStats.bountyEventChecks;
  api._goalProbeChoose(actor);
  assert.equal(game.simStats.bountyEventChecks, checksBefore, 'newly committed goal keeps its opportunity floor');
  game.turn = 11;
  api._goalProbeChoose(actor);
  assert.equal(actor.goal.type, 'explore', 'weak bounty must not break commitment');
  api._goalProbeChoose(actor);
  assert.equal(game.simStats.bountyEventChecks - checksBefore, 1, 'weak bounty must be examined once');

  actor.goal.utility = 0;
  api.postBounty('kill', hostile.id);
  api._goalProbeChoose(actor);
  assert.equal(actor.goal.type, 'engage', 'strong bounty must interrupt');
  assert.equal(actor.goal.bountyId, game.bounties[0].id);
  assert.equal(game.simStats.bountyEventSwitches, 1);

  api._goalProbeCancelBounty(game.bounties[0]);
  api._goalProbeChoose(actor);
  assert.equal(actor.goal.bountyId, null, 'cancelled bounty goal must be dropped');
  assert.ok(game.simStats.goalTargetGone > 0);

  hostile.x = cells[1].x; hostile.y = cells[1].y;
  api._goalProbeChoose(actor);
  assert.equal(actor.goal.target.x, hostile.x, 'visible target must be refreshed');
  assert.equal(actor.goal.target.y, hostile.y);
  assert.equal(actor.goal.path.at(-1).x, hostile.x, 'route must end at refreshed target');
  assert.equal(actor.goal.path.at(-1).y, hostile.y);

  hostile.x = cells[2].x; hostile.y = cells[2].y;
  game.visible[hostile.y * cols + hostile.x] = 0;
  api._goalProbeChoose(actor);
  assert.equal(actor.goal.target.x, cells[1].x, 'unseen target must keep last seen position');
  assert.equal(actor.goal.target.y, cells[1].y);

  // Fighter options compete on one scale: gear beats a trivial hunt, but a
  // nearby raider or a well-paid player flag can pull the hero away.
  game.hostiles.length = 0;
  game.lairs.length = 0;
  game.bounties.length = 0;
  game.danger.fill(0);
  game.visible.fill(1);
  if (!game.built.includes('blacksmith')) game.built.push('blacksmith');
  actor.x = cells[2].x; actor.y = cells[2].y;
  actor.hp = actor.maxHp;
  actor.purse = 150;
  actor.goal = null;
  api._goalProbeChoose(actor);
  assert.equal(actor.goal.type, 'shop', 'affordable gear should draw an idle fighter');

  let distant = null;
  for (let i = 0; i < game.caches.passable.length; i++) {
    const cell = game.caches.passable[i];
    if (game.caches.component[cell] !== game.caches.component[home]) continue;
    const x = cell % cols, y = (cell / cols) | 0;
    const actorDist = Math.abs(x - actor.x) + Math.abs(y - actor.y);
    const castleDist = Math.abs(x - castle.x) + Math.abs(y - castle.y);
    if (actorDist >= 20 && castleDist <= 24) { distant = { x, y }; break; }
  }
  assert.ok(distant, 'probe needs a distant reachable hunt');
  hostile.kind = 'boar'; hostile.raider = false;
  hostile.x = distant.x; hostile.y = distant.y;
  game.hostiles.push(hostile);
  actor.goal = null;
  api._goalProbeChoose(actor);
  assert.equal(actor.goal.type, 'shop', 'a distant minor hunt should not block useful gear');

  hostile.x = cells[0].x; hostile.y = cells[0].y;
  actor.goal = null;
  api._goalProbeChoose(actor);
  assert.equal(actor.goal.type, 'engage', 'a close winnable hunt should beat shopping');

  hostile.kind = 'bandit'; hostile.raider = true;
  actor.goal = null;
  api._goalProbeChoose(actor);
  assert.equal(actor.goal.type, 'engage', 'a nearby raider should beat shopping');

  game.hostiles.length = 0;
  actor.goal = null;
  api.postBounty('patrol', cells[0], 6);
  api._goalProbeChoose(actor);
  assert.equal(actor.goal.type, 'patrol', 'a well-paid patrol should beat shopping');

  api._goalProbeCancelBounty(game.bounties[0]);
  const lair = { id: 'probe-lair', type: 'undead', active: true, destroyed: false, x: cells[0].x, y: cells[0].y };
  game.lairs.push(lair);
  game.discovered[lair.y * cols + lair.x] = 1;
  actor.level = 5;
  actor.goal = null;
  api._goalProbeChoose(actor);
  assert.equal(actor.goal.type, 'assault', 'ready fighter should consider a known lair');
  const unflaggedLairUtility = actor.goal.utility;
  actor.goal = null;
  api.postBounty('lair', lair.id);
  api._goalProbeChoose(actor);
  assert.ok(actor.goal.utility > unflaggedLairUtility, 'a lair bounty must increase its utility');
  api._goalProbeCancelBounty(game.bounties[0]);
  actor.goal = null;
  api.postBounty('lair', lair.id, 6);
  api._goalProbeChoose(actor);
  assert.equal(actor.goal.type, 'assault', 'a well-paid lair should beat shopping');
  api._goalProbeCancelBounty(game.bounties[0]);
  game.lairs.length = 0;
  actor.x = cells[0].x; actor.y = cells[0].y;
  actor.goal = null;
  api.postBounty('patrol', cells[0], 6);
  api._goalProbeChoose(actor);
  assert.equal(actor.goal.type, 'patrol', 'a fighter on a paid post should hold it');
  assert.equal(actor.goal.path.length, 0);
  api._goalProbeArrival(actor);
  assert.equal(actor.goal.type, 'patrol', 'arrival must not end a paid patrol');
  api._goalProbeChoose(actor);
  assert.equal(actor.goal.type, 'patrol', 'the patrol should remain valid while its flag is live');
  console.log('Goal probes passed: event transitions and fighter hunt/shop/patrol/lair choices.');
}

const options = parseArgs(process.argv);
const api = loadSimulationApi();
if (options.probeGoals) {
  probeGoalEvents(api);
  process.exit(0);
}
const checkpoints = makeCheckpoints(options.turns);

if (options.compare) {
  const seeds = [];
  for (let i = 0; i < options.games; i++) seeds.push((options.seed + Math.imul(i, 2654435761)) >>> 0 || 1);
  console.log(`Strategy comparison — ${options.games} games x ${options.turns} turns each (same seeds)\n`);
  printCompareHeader();
  for (const policy of ALL_POLICIES) {
    const policyRuns = seeds.map(seed => runGame(api, seed, options.turns, checkpoints, policy));
    printCompareRow(policy, summarize(policyRuns, checkpoints));
  }
  process.exit(0);
}

const runs = [];
for (let i = 0; i < options.games; i++) {
  const seed = (options.seed + Math.imul(i, 2654435761)) >>> 0;
  runs.push(runGame(api, seed || 1, options.turns, checkpoints, options.policy));
}
console.log(`Policy: ${options.policy}`);
const summary = summarize(runs, checkpoints);
const output = { options, checkpoints, summary, runs };
if (options.json) console.log(JSON.stringify(output, null, 2));
else printSummary(summary, runs, checkpoints);
