#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

const ALL_POLICIES = ['economy', 'defense', 'heroes', 'rogues', 'balanced'];

function parseArgs(argv) {
  const options = { games: 10, turns: 100, seed: 0x5eed1234, json: false, policy: 'balanced', compare: false };
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--json') {
      options.json = true;
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

class FakeClassList {
  constructor() {
    this.values = new Set();
  }
  add(name) {
    this.values.add(name);
  }
  remove(name) {
    this.values.delete(name);
  }
  contains(name) {
    return this.values.has(name);
  }
  toggle(name, force) {
    if (force === undefined ? !this.values.has(name) : force) {
      this.values.add(name);
      return true;
    }
    this.values.delete(name);
    return false;
  }
}

class FakeStyle {
  constructor() {
    this.props = Object.create(null);
  }
  setProperty(name, value) {
    this.props[name] = value;
  }
}

class FakeElement {
  constructor(id = '', tagName = 'div') {
    this.id = id;
    this.tagName = tagName;
    this.children = [];
    this.dataset = Object.create(null);
    this.style = new FakeStyle();
    this.classList = new FakeClassList();
    this.clientWidth = id === 'viewport' ? 390 : 0;
    this.clientHeight = id === 'viewport' ? 844 : 0;
    this._textContent = '';
    this.innerHTML = '';
  }
  appendChild(child) {
    if (child && child.isFragment) {
      for (let i = 0; i < child.children.length; i++) this.children.push(child.children[i]);
    } else {
      this.children.push(child);
    }
    return child;
  }
  addEventListener() {}
  removeAttribute(name) {
    if (name === 'data-x') delete this.dataset.x;
    else if (name === 'data-y') delete this.dataset.y;
    else if (name === 'data-t') delete this.dataset.t;
    else if (name === 'data-view') delete this.dataset.view;
    else delete this[name];
  }
  setPointerCapture() {}
  getBoundingClientRect() {
    return {
      left: 0,
      top: 0,
      right: this.clientWidth,
      bottom: this.clientHeight,
      width: this.clientWidth,
      height: this.clientHeight,
    };
  }
  set textContent(value) {
    this._textContent = String(value);
    if (value === '') this.children.length = 0;
  }
  get textContent() {
    return this._textContent;
  }
}

function createHarnessContext() {
  const elements = new Map();
  const getElement = id => {
    let element = elements.get(id);
    if (!element) {
      element = new FakeElement(id);
      elements.set(id, element);
    }
    return element;
  };

  const document = {
    body: new FakeElement('body', 'body'),
    getElementById: getElement,
    createElement: tagName => new FakeElement('', tagName),
    createDocumentFragment() {
      const fragment = new FakeElement('', '#fragment');
      fragment.isFragment = true;
      return fragment;
    },
  };

  const context = {
    console,
    document,
    navigator: { userAgent: 'lor-sim-harness', userAgentData: { mobile: false } },
    setTimeout,
    clearTimeout,
    requestAnimationFrame: callback => setTimeout(callback, 0),
  };
  context.window = context;
  context.window.matchMedia = () => ({ matches: false });
  context.window.addEventListener = () => {};
  context.window.getSelection = () => ({ removeAllRanges() {} });
  return context;
}

function loadSimulationApi() {
  const html = fs.readFileSync(path.join(rootDir, 'index.html'), 'utf8');
  const match = html.match(/<script>([\s\S]*)<\/script>/);
  if (!match) throw new Error('Could not find inline script in index.html');
  const context = createHarnessContext();
  vm.runInNewContext(match[1], context, { filename: 'index.html' });
  if (!context.window.__lorTest) throw new Error('window.__lorTest was not exposed');
  return context.window.__lorTest;
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

  for (let step = 0; step < turns; step++) {
    const result = api.stepTurn();
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
  }
  const elapsedMs = performance.now() - startedAt;
  snapshot = api.snapshot();

  return {
    seed,
    finalTurn: snapshot.turn,
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
    shopIncome: snapshot.shopIncome || 0,
    heroGold: snapshot.heroGold || 0,
    avgEquipTier: snapshot.avgEquipTier || 0,
    ruinsExplored: snapshot.ruinsExplored || 0,
    heroes: snapshot.heroes,
    tamings: snapshot.simStats ? (snapshot.simStats.tamings || 0) : 0,
    beastLevelUps: snapshot.simStats ? (snapshot.simStats.beastLevelUps || 0) : 0,
    potionsBought: snapshot.simStats ? (snapshot.simStats.potionsBought || 0) : 0,
    potionsQuaffed: snapshot.simStats ? (snapshot.simStats.potionsQuaffed || 0) : 0,
    heroesHired: snapshot.heroesHired || 0,
    heroDeaths: snapshot.simStats ? (snapshot.simStats.heroDeaths || 0) : 0,
    heroDeathLevels: snapshot.simStats ? (snapshot.simStats.heroDeathLevels || {}) : {},
    huntsFilled: snapshot.simStats ? (snapshot.simStats.huntsFilled || 0) : 0,
    huntFood: snapshot.simStats ? (snapshot.simStats.huntFood || 0) : 0,
    extortions: snapshot.simStats ? (snapshot.simStats.extortions || 0) : 0,
    stealths: snapshot.simStats ? (snapshot.simStats.stealths || 0) : 0,
    ruinGearFinds: snapshot.simStats ? (snapshot.simStats.ruinGearFinds || 0) : 0,
    ruinSkeletons: snapshot.simStats ? (snapshot.simStats.ruinSkeletons || 0) : 0,
    villagesAlive: snapshot.villagesAlive || 0,
    villagesFounded: snapshot.villagesFounded || 0,
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
    winterShare: winterTurns / turns,
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
  };
  const pop = Object.create(null);
  const food = Object.create(null);
  const coin = Object.create(null);
  const tier = Object.create(null);
  const built = Object.create(null);
  for (const c of checkpoints) { pop[c] = []; food[c] = []; coin[c] = []; tier[c] = []; built[c] = []; }

  for (const run of runs) {
    totalCombatRounds += run.combatRounds;
    totalHostileKills += run.hostileKills;
    totalElapsedMs += run.elapsedMs;
    if (run.simStats) {
      for (const k of Object.keys(simStats)) simStats[k] += run.simStats[k] || 0;
    }
    for (const c of checkpoints) {
      pop[c].push(run.popAt[c] ?? run.finalPopulation);
      food[c].push(run.foodAt[c] ?? run.finalFood);
      coin[c].push(run.coinAt[c] ?? run.finalCoin);
      tier[c].push((run.tierAt[c] ?? run.finalTier) + 1);
      built[c].push(run.builtAt[c] ?? run.finalBuilt.length);
    }
  }

  const avgAt = src => { const o = Object.create(null); for (const c of checkpoints) o[c] = average(src[c]); return o; };

  return {
    games: runs.length,
    turns: runs[0] ? runs[0].finalTurn - 1 : 0,
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
    avgShopIncome: average(runs.map(r => r.shopIncome)),
    avgHeroGold: average(runs.map(r => r.heroGold)),
    avgEquipTier: average(runs.map(r => r.avgEquipTier)),
    avgRuinsExplored: average(runs.map(r => r.ruinsExplored)),
    avgRuinGearFinds: average(runs.map(r => r.ruinGearFinds)),
    avgRuinSkeletons: average(runs.map(r => r.ruinSkeletons)),
    avgTamings: average(runs.map(r => r.tamings)),
    avgBeastLevelUps: average(runs.map(r => r.beastLevelUps)),
    avgPotionsBought: average(runs.map(r => r.potionsBought)),
    avgPotionsQuaffed: average(runs.map(r => r.potionsQuaffed)),
    avgHuntsFilled: average(runs.map(r => r.huntsFilled)),
    avgHuntFood: average(runs.map(r => r.huntFood)),
    avgExtortions: average(runs.map(r => r.extortions)),
    avgStealths: average(runs.map(r => r.stealths)),
    avgHeroesHired: average(runs.map(r => r.heroesHired)),
    avgHeroDeaths: average(runs.map(r => r.heroDeaths)),
    heroDeathRatio: (() => { const h = runs.reduce((s, r) => s + r.heroesHired, 0); const d = runs.reduce((s, r) => s + r.heroDeaths, 0); return h ? d / h : 0; })(),
    heroDeathByLevel: (() => { const o = {}; for (const r of runs) for (const [k, v] of Object.entries(r.heroDeathLevels)) o[k] = (o[k] || 0) + v; return o; })(),
    avgVillagesFounded: average(runs.map(r => r.villagesFounded)),
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
    avgHeroTotal: average(runs.map(r => r.heroes.ranger + r.heroes.rogue + r.heroes.fighter + r.heroes.monster)),
    avgWaves: average(runs.map(r => r.waves)),
    avgHeroes: {
      ranger: average(runs.map(r => r.heroes.ranger)),
      rogue: average(runs.map(r => r.heroes.rogue)),
      fighter: average(runs.map(r => r.heroes.fighter)),
      monster: average(runs.map(r => r.heroes.monster)),
    },
    perf: {
      elapsedMs: totalElapsedMs,
      turnsPerSecond: simStats.turns ? simStats.turns / (totalElapsedMs / 1000) : 0,
      avgTurnMs: simStats.turns ? simStats.turnMs / simStats.turns : 0,
      avgPathMs: simStats.pathCalls ? simStats.pathMs / simStats.pathCalls : 0,
      pathCallsPerTurn: simStats.turns ? simStats.pathCalls / simStats.turns : 0,
    },
  };
}

function printSummary(summary, runs, checkpoints) {
  console.log(`Simulated ${summary.games} games x ${summary.turns} turns`);
  console.log('City economy (avg over games):');
  console.log(`  ${'turn'.padStart(5)} | ${'pop'.padStart(5)} ${'tier'.padStart(5)} ${'food'.padStart(6)} ${'coin'.padStart(6)} ${'bldgs'.padStart(6)}`);
  for (const c of checkpoints) {
    console.log(`  ${('T' + c).padStart(5)} | ${summary.popAt[c].toFixed(1).padStart(5)} ${summary.tierAt[c].toFixed(1).padStart(5)} ${summary.foodAt[c].toFixed(0).padStart(6)} ${summary.coinAt[c].toFixed(0).padStart(6)} ${summary.builtAt[c].toFixed(1).padStart(6)}`);
  }
  console.log(`Final: pop ${summary.avgFinalPopulation.toFixed(1)}, tier ${summary.avgFinalTier.toFixed(1)}, coin ${summary.avgFinalCoin.toFixed(0)}, buildings ${summary.avgFinalBuilt.toFixed(1)}, guards ${summary.avgFinalGuards.toFixed(1)}`);
  console.log(`Defense: raid waves/game ${summary.avgWaves.toFixed(1)}, hostile kills/game ${summary.avgHostileKills.toFixed(1)}, combat exch/game ${summary.avgCombatRounds.toFixed(1)}, guards fallen/game ${summary.avgGuardsFallen.toFixed(2)}, friendly deaths/game ${summary.avgFriendlyDeaths.toFixed(1)}, pop lost to raids/game ${summary.avgRaidsLost.toFixed(2)}`);
  console.log(`Stability: min pop ${summary.avgMinPop.toFixed(1)}, collapse rate ${(summary.collapseRate * 100).toFixed(0)}%`);
  console.log(`Seasons: winters/game ${summary.avgWinters.toFixed(1)}, time in winter ${(summary.avgWinterShare * 100).toFixed(0)}%`);
  console.log(`Lairs: ${summary.avgLairsTotal.toFixed(1)}/map, cleared/game ${summary.avgLairsCleared.toFixed(1)}, still active at end ${summary.avgLairsActive.toFixed(1)}`);
  console.log(`Hero gold: wild minted/game ${summary.avgWildGold.toFixed(0)}, shop income/game ${summary.avgShopIncome.toFixed(0)}, unspent purses ${summary.avgHeroGold.toFixed(0)}, avg gear tier ${summary.avgEquipTier.toFixed(2)}, ruins delved ${summary.avgRuinsExplored.toFixed(1)}`);
  console.log(`Ruins: gear caches/game ${summary.avgRuinGearFinds.toFixed(2)}, skeletons roused/game ${summary.avgRuinSkeletons.toFixed(2)}`);
  console.log(`Potions: bought/game ${summary.avgPotionsBought.toFixed(1)}, quaffed/game ${summary.avgPotionsQuaffed.toFixed(1)}`);
  console.log(`Heroes: hired/game ${summary.avgHeroesHired.toFixed(1)}, deaths/game ${summary.avgHeroDeaths.toFixed(1)}, death ratio ${(summary.heroDeathRatio * 100).toFixed(0)}%, deaths by level ${JSON.stringify(summary.heroDeathByLevel)}`);
  const h = summary.avgHeroes;
  console.log(`Heroes (final avg): ranger ${h.ranger.toFixed(1)}, rogue ${h.rogue.toFixed(1)}, fighter ${h.fighter.toFixed(1)}, monster ${h.monster.toFixed(1)}`);
  console.log(`Taming: tamed/game ${summary.avgTamings.toFixed(2)}, level-ups/game ${summary.avgBeastLevelUps.toFixed(2)}, beasts alive at end ${summary.avgBeastsAlive.toFixed(2)}, avg surviving level ${(summary.avgBeastLevel || 0).toFixed(2)}`);
  console.log(`Villages: founded/game ${summary.avgVillagesFounded.toFixed(2)}, alive at end ${summary.avgVillagesAlive.toFixed(2)}, destroyed/game ${summary.avgVillagesDestroyed.toFixed(2)}`);
  console.log(`Carts: sent/game ${summary.avgCartsSent.toFixed(2)}, delivered ${summary.avgCartsDelivered.toFixed(2)}, lost ${summary.avgCartsLost.toFixed(2)}, coin delivered/game ${summary.avgVillageCoin.toFixed(0)}, food ${summary.avgVillageFood.toFixed(0)}`);
  console.log(`Hunts: filled/game ${summary.avgHuntsFilled.toFixed(2)}, hunt food/game ${summary.avgHuntFood.toFixed(0)}`);
  console.log(`Rogues: extortions/game ${summary.avgExtortions.toFixed(2)}, stealths/game ${summary.avgStealths.toFixed(2)}`);
  console.log('Performance:');
  console.log(`  turns/sec: ${summary.perf.turnsPerSecond.toFixed(1)}`);
  console.log(`  avg turn compute: ${summary.perf.avgTurnMs.toFixed(3)} ms`);
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

const options = parseArgs(process.argv);
const api = loadSimulationApi();
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
