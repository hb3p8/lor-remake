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
  const actorDeathTurns = Object.create(null);
  const discoveredAt = Object.create(null);
  const foodAt = Object.create(null);
  const farmsAt = Object.create(null);
  let combats = 0;
  let hostileKills = 0;
  let foodEvents = 0;
  let farmEvents = 0;
  let ruinSearches = 0;

  for (let step = 0; step < turns; step++) {
    const beforeActors = snapshot.actors;
    const result = api.stepTurn();
    snapshot = result.snapshot;
    combats += result.combats;
    for (let i = 0; i < result.events.length; i++) {
      const event = result.events[i];
      if (/killed/i.test(event)) hostileKills++;
      if (/delivered .* food to castle/i.test(event)) foodEvents++;
      if (/castle field|castle fields/i.test(event)) farmEvents++;
      if (/searched old ruins/i.test(event)) ruinSearches++;
    }
    for (let i = 0; i < snapshot.actors.length; i++) {
      const actor = snapshot.actors[i];
      if (!actor.alive && actorDeathTurns[actor.id] === undefined) {
        const wasAlive = beforeActors[i] && beforeActors[i].alive;
        if (wasAlive) actorDeathTurns[actor.id] = snapshot.turn;
      }
    }
    for (let i = 0; i < checkpoints.length; i++) {
      const checkpoint = checkpoints[i];
      if (snapshot.turn - 1 === checkpoint) {
        discoveredAt[checkpoint] = snapshot.discovered;
        foodAt[checkpoint] = snapshot.food;
        farmsAt[checkpoint] = snapshot.castleFarms;
      }
    }
  }

  return {
    seed,
    finalTurn: snapshot.turn,
    actorDeathTurns,
    discoveredAt,
    foodAt,
    farmsAt,
    finalDiscovered: snapshot.discovered,
    finalDiscoveredPct: snapshot.discoveredPct,
    finalFood: snapshot.food,
    finalCoin: snapshot.coin,
    ruinsDiscovered: snapshot.ruinsDiscovered,
    ruinsExplored: snapshot.ruinsExplored,
    hostilesAlive: snapshot.hostilesAlive,
    combats,
    hostileKills,
    foodEvents,
    farmEvents,
    ruinSearches,
  };
}

function summarize(runs, checkpoints) {
  const scoutDeaths = [];
  let scoutDeathCount = 0;
  let totalCombats = 0;
  let totalHostileKills = 0;
  let totalFoodEvents = 0;
  let totalFarmEvents = 0;
  let totalRuinSearches = 0;
  const discovery = Object.create(null);
  const food = Object.create(null);
  const farms = Object.create(null);
  for (let i = 0; i < checkpoints.length; i++) {
    discovery[checkpoints[i]] = [];
    food[checkpoints[i]] = [];
    farms[checkpoints[i]] = [];
  }

  for (let i = 0; i < runs.length; i++) {
    const run = runs[i];
    if (run.actorDeathTurns.scout !== undefined) {
      scoutDeathCount++;
      scoutDeaths.push(run.actorDeathTurns.scout);
    }
    totalCombats += run.combats;
    totalHostileKills += run.hostileKills;
    totalFoodEvents += run.foodEvents;
    totalFarmEvents += run.farmEvents;
    totalRuinSearches += run.ruinSearches;
    for (let c = 0; c < checkpoints.length; c++) {
      const checkpoint = checkpoints[c];
      discovery[checkpoint].push(run.discoveredAt[checkpoint] || run.finalDiscovered);
      food[checkpoint].push(run.foodAt[checkpoint] ?? run.finalFood);
      farms[checkpoint].push(run.farmsAt[checkpoint] ?? 0);
    }
  }

  const averageDiscovered = Object.create(null);
  const averageFood = Object.create(null);
  const averageCastleFarms = Object.create(null);
  for (let i = 0; i < checkpoints.length; i++) {
    const checkpoint = checkpoints[i];
    averageDiscovered[checkpoint] = average(discovery[checkpoint]);
    averageFood[checkpoint] = average(food[checkpoint]);
    averageCastleFarms[checkpoint] = average(farms[checkpoint]);
  }

  return {
    games: runs.length,
    turns: runs[0] ? runs[0].finalTurn - 1 : 0,
    scout: {
      deathRate: scoutDeathCount / runs.length,
      averageDeathTurn: average(scoutDeaths),
      survivedGames: runs.length - scoutDeathCount,
    },
    averageDiscovered,
    averageFood,
    averageCastleFarms,
    averageCombats: totalCombats / runs.length,
    averageHostileKills: totalHostileKills / runs.length,
    averageFoodEvents: totalFoodEvents / runs.length,
    averageFarmEvents: totalFarmEvents / runs.length,
    averageRuinSearches: totalRuinSearches / runs.length,
  };
}

function formatPercent(value) {
  return `${(value * 100).toFixed(1)}%`;
}

function printSummary(summary, runs, checkpoints) {
  console.log(`Simulated ${summary.games} games x ${summary.turns} turns`);
  console.log(`Scout death rate: ${formatPercent(summary.scout.deathRate)} (${summary.scout.survivedGames}/${summary.games} survived)`);
  console.log(`Scout average death turn: ${summary.scout.averageDeathTurn === null ? 'n/a' : summary.scout.averageDeathTurn.toFixed(1)}`);
  console.log(`Average combats/game: ${summary.averageCombats.toFixed(1)}`);
  console.log(`Average hostile kills/game: ${summary.averageHostileKills.toFixed(1)}`);
  console.log(`Average food hunt events/game: ${summary.averageFoodEvents.toFixed(1)}`);
  console.log(`Average castle farm events/game: ${summary.averageFarmEvents.toFixed(1)}`);
  console.log(`Average ruin searches/game: ${summary.averageRuinSearches.toFixed(1)}`);
  console.log('Exploration:');
  for (let i = 0; i < checkpoints.length; i++) {
    const checkpoint = checkpoints[i];
    const tiles = summary.averageDiscovered[checkpoint];
    console.log(`  T${String(checkpoint).padStart(3, ' ')}: ${tiles.toFixed(1)} tiles (${formatPercent(tiles / 6000)})`);
  }
  console.log('Food:');
  for (let i = 0; i < checkpoints.length; i++) {
    const checkpoint = checkpoints[i];
    console.log(`  T${String(checkpoint).padStart(3, ' ')}: ${summary.averageFood[checkpoint].toFixed(1)} food, ${summary.averageCastleFarms[checkpoint].toFixed(1)} castle farms`);
  }
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
