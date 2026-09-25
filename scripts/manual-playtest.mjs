#!/usr/bin/env node
import readline from 'node:readline';
import { loadSimulationApi } from './sim-runtime.mjs';

const api = loadSimulationApi();
const help = 'new SEED [freeplay|charter|convoy|marches|winter|ore|crypt|bandits|trade] | state | map [RADIUS] | sites [LIMIT] | step [COUNT] | build ID | tower X Y | hire GUILD | upgrade | sell | bounty explore|patrol X Y | bounty kill|hunt|lair ID | cancel ID | canfound X Y [SPEC] | found X Y SPEC | vbuild X Y militia|inn|guardhouse | quit';
const scenarioIds = new Set(['freeplay', 'charter', 'convoy', 'marches', 'winter', 'ore', 'crypt', 'bandits', 'trade']);

function emit(value) { process.stdout.write(JSON.stringify(value) + '\n'); }
function integer(value, label) {
  const number = Number(value);
  if (!Number.isInteger(number)) throw new Error(`${label} must be an integer`);
  return number;
}
function seed(value) { return integer(value, 'seed') >>> 0; }
function state() {
  const result = api.manualState();
  if (!result) throw new Error('Start a game with new SEED or --seed SEED');
  return result;
}
function action(name, result) { emit({ action: name, result, state: state() }); }
function command(line) {
  const parts = line.trim().split(/\s+/);
  const name = parts[0];
  if (!name) return;
  if (name === 'help') { process.stdout.write(help + '\n'); return; }
  if (name === 'quit' || name === 'exit') return 'quit';
  if (name === 'new') {
    const scenario = parts[2] || 'freeplay';
    if (!scenarioIds.has(scenario)) throw new Error(`Unknown scenario: ${scenario}`);
    api.newGame(seed(parts[1]), { render: false, manual: true, scenario });
    emit(state());
    return;
  }
  if (name === 'state') { emit(state()); return; }
  if (name === 'map') {
    state();
    const radius = parts[1] === undefined ? 9 : integer(parts[1], 'radius');
    if (radius < 1 || radius > 30) throw new Error('radius must be between 1 and 30');
    emit(api.manualMap(radius));
    return;
  }
  if (name === 'sites') {
    state();
    const limit = parts[1] === undefined ? 30 : integer(parts[1], 'limit');
    if (limit < 1 || limit > 100) throw new Error('limit must be between 1 and 100');
    emit(api.manualSites(limit));
    return;
  }
  if (name === 'step') {
    state();
    const count = parts[1] === undefined ? 1 : integer(parts[1], 'count');
    if (count < 1 || count > 100) throw new Error('count must be between 1 and 100');
    const turns = [];
    for (let i = 0; i < count; i++) {
      const result = api.stepTurn();
      if (!result) break;
      turns.push({ turn: result.snapshot.turn, combats: result.combats, events: result.events });
    }
    emit({ turns, state: state() });
    return;
  }
  state();
  if (name === 'build') { action(`build ${parts[1]}`, api.manualBuild(parts[1])); return; }
  if (name === 'tower') {
    const x = integer(parts[1], 'x'), y = integer(parts[2], 'y');
    action(`tower ${x} ${y}`, api.manualBuildWatchtower(x, y));
    return;
  }
  if (name === 'hire') { action(`hire ${parts[1]}`, api.manualHire(parts[1])); return; }
  if (name === 'upgrade') { action('upgrade', api.manualUpgrade()); return; }
  if (name === 'sell') { action('sell food', api.manualSellFood()); return; }
  if (name === 'bounty') {
    const type = parts[1];
    const key = type === 'explore' || type === 'patrol'
      ? { x: integer(parts[2], 'x'), y: integer(parts[3], 'y') }
      : parts[2];
    action(`bounty ${parts.slice(1).join(' ')}`, api.manualBounty(type, key));
    return;
  }
  if (name === 'cancel') { action(`cancel ${parts[1]}`, api.manualCancelBounty(integer(parts[1], 'id'))); return; }
  if (name === 'vbuild') {
    const x = integer(parts[1], 'x'), y = integer(parts[2], 'y');
    action(`vbuild ${x} ${y} ${parts[3]}`, api.manualBuildVillage(x, y, parts[3]));
    return;
  }
  if (name === 'canfound' || name === 'found') {
    const x = integer(parts[1], 'x'), y = integer(parts[2], 'y');
    if (name === 'canfound') emit({ x, y, result: api.manualCanFoundVillage(x, y, parts[3]) });
    else {
      if (!parts[3]) throw new Error('Choose a specialization: fields, forest, mine, or fish');
      action(`found ${x} ${y} ${parts[3]}`, api.manualFoundVillage(x, y, parts[3]));
    }
    return;
  }
  throw new Error(`Unknown command: ${name}. ${help}`);
}

const arg = process.argv.indexOf('--seed');
if (arg !== -1) {
  const scenarioArg = process.argv.indexOf('--scenario');
  try { command(`new ${process.argv[arg + 1]} ${scenarioArg !== -1 ? process.argv[scenarioArg + 1] : 'freeplay'}`); }
  catch (error) { emit({ error: error.message }); process.exitCode = 1; }
}
const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on('line', line => {
  try { if (command(line) === 'quit') rl.close(); }
  catch (error) { emit({ error: error.message }); }
});
