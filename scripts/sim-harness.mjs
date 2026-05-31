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
  const coinAt = Object.create(null);
  const tierAt = Object.create(null);
  const builtAt = Object.create(null);
  let combatRounds = 0;
  let hostileKills = 0;
  let guardsFallen = 0;

  for (let step = 0; step < turns; step++) {
    const result = api.stepTurn();
    snapshot = result.snapshot;
    combatRounds += result.combats;
    for (let i = 0; i < result.events.length; i++) {
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
    hostilesAlive: snapshot.hostilesAlive,
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
    avgWaves: average(runs.map(r => r.waves)),
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
  console.log(`Defense: raid waves/game ${summary.avgWaves.toFixed(1)}, hostile kills/game ${summary.avgHostileKills.toFixed(1)}, combat exch/game ${summary.avgCombatRounds.toFixed(1)}, guards fallen/game ${summary.avgGuardsFallen.toFixed(2)}, pop lost to raids/game ${summary.avgRaidsLost.toFixed(2)}`);
  console.log('Performance:');
  console.log(`  turns/sec: ${summary.perf.turnsPerSecond.toFixed(1)}`);
  console.log(`  avg turn compute: ${summary.perf.avgTurnMs.toFixed(3)} ms`);
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
