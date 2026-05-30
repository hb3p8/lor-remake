#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

function parseArgs(argv) {
  const options = { games: 10, turns: 100, seed: 0x5eed1234, json: false };
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--json') {
      options.json = true;
    } else if (arg === '--games') {
      options.games = Math.max(1, Number(argv[++i]) | 0);
    } else if (arg === '--turns') {
      options.turns = Math.max(1, Number(argv[++i]) | 0);
    } else if (arg === '--seed') {
      options.seed = Number(argv[++i]) >>> 0;
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

function runGame(api, seed, turns, checkpoints) {
  let snapshot = api.newGame(seed, { render: false });
  api.resetStats();
  const startedAt = performance.now();
  const popAt = Object.create(null);
  const foodAt = Object.create(null);
  const woodAt = Object.create(null);
  const tierAt = Object.create(null);
  let combatRounds = 0;
  let hostileKills = 0;
  let deliveries = 0;
  let settlerDeaths = 0;
  let flees = 0;

  for (let step = 0; step < turns; step++) {
    const result = api.stepTurn();
    snapshot = result.snapshot;
    combatRounds += result.combats;
    for (let i = 0; i < result.events.length; i++) {
      const event = result.events[i];
      if (/killed/i.test(event)) hostileKills++;
      if (/delivered .* to the castle/i.test(event)) deliveries++;
      if (/died fighting/i.test(event)) settlerDeaths++;
      if (/fled|escaped|broke off/i.test(event)) flees++;
    }
    for (let i = 0; i < checkpoints.length; i++) {
      const checkpoint = checkpoints[i];
      if (snapshot.turn - 1 === checkpoint) {
        popAt[checkpoint] = snapshot.population;
        foodAt[checkpoint] = snapshot.food;
        woodAt[checkpoint] = snapshot.wood;
        tierAt[checkpoint] = snapshot.castleTier;
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
    woodAt,
    tierAt,
    finalPopulation: snapshot.population,
    finalHousing: snapshot.housing,
    finalTier: snapshot.castleTier,
    finalIdle: snapshot.idle,
    finalJobs: snapshot.jobs,
    finalBuilt: snapshot.built,
    finalFood: snapshot.food,
    finalWood: snapshot.wood,
    finalCoin: snapshot.coin,
    hostilesAlive: snapshot.hostilesAlive,
    combatRounds,
    hostileKills,
    deliveries,
    settlerDeaths,
    flees,
    elapsedMs,
    simStats: snapshot.simStats,
  };
}

const JOB_IDS = ['farmer', 'hunter', 'woodcutter', 'guard'];

function summarize(runs, checkpoints) {
  let totalCombatRounds = 0;
  let totalHostileKills = 0;
  let totalDeliveries = 0;
  let totalSettlerDeaths = 0;
  let totalFlees = 0;
  let totalElapsedMs = 0;
  const simStats = {
    turns: 0, turnMs: 0, goalCalls: 0, goalMs: 0,
    pathCalls: 0, pathMs: 0, candidateCells: 0, candidateCount: 0,
  };
  const pop = Object.create(null);
  const food = Object.create(null);
  const wood = Object.create(null);
  const tier = Object.create(null);
  for (const c of checkpoints) { pop[c] = []; food[c] = []; wood[c] = []; tier[c] = []; }
  const finalJobs = Object.create(null);
  for (const j of JOB_IDS) finalJobs[j] = [];

  for (const run of runs) {
    totalCombatRounds += run.combatRounds;
    totalHostileKills += run.hostileKills;
    totalDeliveries += run.deliveries;
    totalSettlerDeaths += run.settlerDeaths;
    totalFlees += run.flees;
    totalElapsedMs += run.elapsedMs;
    if (run.simStats) {
      for (const k of Object.keys(simStats)) simStats[k] += run.simStats[k] || 0;
    }
    for (const c of checkpoints) {
      pop[c].push(run.popAt[c] ?? run.finalPopulation);
      food[c].push(run.foodAt[c] ?? run.finalFood);
      wood[c].push(run.woodAt[c] ?? run.finalWood);
      tier[c].push((run.tierAt[c] ?? run.finalTier) + 1);
    }
    for (const j of JOB_IDS) finalJobs[j].push(run.finalJobs[j] || 0);
  }

  const avgAt = src => { const o = Object.create(null); for (const c of checkpoints) o[c] = average(src[c]); return o; };
  const avgJobs = Object.create(null);
  for (const j of JOB_IDS) avgJobs[j] = average(finalJobs[j]);

  return {
    games: runs.length,
    turns: runs[0] ? runs[0].finalTurn - 1 : 0,
    popAt: avgAt(pop),
    foodAt: avgAt(food),
    woodAt: avgAt(wood),
    tierAt: avgAt(tier),
    avgFinalPopulation: average(runs.map(r => r.finalPopulation)),
    avgFinalTier: average(runs.map(r => r.finalTier + 1)),
    avgFinalCoin: average(runs.map(r => r.finalCoin)),
    avgJobs,
    avgSettlerDeaths: totalSettlerDeaths / runs.length,
    avgCombatRounds: totalCombatRounds / runs.length,
    avgHostileKills: totalHostileKills / runs.length,
    avgDeliveries: totalDeliveries / runs.length,
    avgFlees: totalFlees / runs.length,
    perf: {
      elapsedMs: totalElapsedMs,
      turnsPerSecond: simStats.turns ? simStats.turns / (totalElapsedMs / 1000) : 0,
      avgTurnMs: simStats.turns ? simStats.turnMs / simStats.turns : 0,
      avgGoalMs: simStats.goalCalls ? simStats.goalMs / simStats.goalCalls : 0,
      avgPathMs: simStats.pathCalls ? simStats.pathMs / simStats.pathCalls : 0,
      pathCallsPerTurn: simStats.turns ? simStats.pathCalls / simStats.turns : 0,
    },
  };
}

function printSummary(summary, runs, checkpoints) {
  console.log(`Simulated ${summary.games} games x ${summary.turns} turns`);
  console.log('City growth (avg over games):');
  console.log(`  ${'turn'.padStart(5)} | ${'pop'.padStart(5)} ${'tier'.padStart(5)} ${'food'.padStart(6)} ${'wood'.padStart(6)}`);
  for (const c of checkpoints) {
    console.log(`  ${('T' + c).padStart(5)} | ${summary.popAt[c].toFixed(1).padStart(5)} ${summary.tierAt[c].toFixed(1).padStart(5)} ${summary.foodAt[c].toFixed(0).padStart(6)} ${summary.woodAt[c].toFixed(0).padStart(6)}`);
  }
  console.log(`Final: pop ${summary.avgFinalPopulation.toFixed(1)}, tier ${summary.avgFinalTier.toFixed(1)}, coin ${summary.avgFinalCoin.toFixed(0)}`);
  console.log(`Final jobs: ${JOB_IDS.map(j => `${j} ${summary.avgJobs[j].toFixed(1)}`).join(', ')}`);
  console.log('Combat & economy:');
  console.log(`  settler deaths/game: ${summary.avgSettlerDeaths.toFixed(2)}`);
  console.log(`  hostile kills/game:  ${summary.avgHostileKills.toFixed(1)}`);
  console.log(`  deliveries/game:     ${summary.avgDeliveries.toFixed(1)}`);
  console.log(`  combat exchanges/game: ${summary.avgCombatRounds.toFixed(1)}`);
  console.log(`  flees/game: ${summary.avgFlees.toFixed(1)}`);
  console.log('Performance:');
  console.log(`  turns/sec: ${summary.perf.turnsPerSecond.toFixed(1)}`);
  console.log(`  avg turn compute: ${summary.perf.avgTurnMs.toFixed(3)} ms`);
  console.log(`  avg pathfind: ${summary.perf.avgPathMs.toFixed(3)} ms  (${summary.perf.pathCallsPerTurn.toFixed(1)} calls/turn)`);
  console.log('Seeds:');
  console.log(`  ${runs.map(run => run.seed).join(', ')}`);
}

const options = parseArgs(process.argv);
const api = loadSimulationApi();
const checkpoints = makeCheckpoints(options.turns);
const runs = [];
for (let i = 0; i < options.games; i++) {
  const seed = (options.seed + Math.imul(i, 2654435761)) >>> 0;
  runs.push(runGame(api, seed || 1, options.turns, checkpoints));
}
const summary = summarize(runs, checkpoints);
const output = { options, checkpoints, summary, runs };
if (options.json) console.log(JSON.stringify(output, null, 2));
else printSummary(summary, runs, checkpoints);
