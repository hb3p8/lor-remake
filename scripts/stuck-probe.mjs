// Stuck-actor diagnostic. Runs games headless, tracks each actor's tile across
// turns, flags any that sit still for >= STUCK_TURNS consecutive turns, and
// records WHY (the movement-gating state at the moment they were stuck).
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

// ---- minimal fake DOM (mirrors sim-harness) -------------------------------
class FakeClassList { constructor(){this.v=new Set();} add(n){this.v.add(n);} remove(n){this.v.delete(n);} contains(n){return this.v.has(n);} toggle(n,f){ if(f===undefined?!this.v.has(n):f){this.v.add(n);return true;} this.v.delete(n);return false; } }
class FakeStyle { constructor(){this.props=Object.create(null);} setProperty(n,v){this.props[n]=v;} }
class FakeElement {
  constructor(id='',tag='div'){ this.id=id;this.tagName=tag;this.children=[];this.dataset=Object.create(null);this.style=new FakeStyle();this.classList=new FakeClassList();this.clientWidth=id==='viewport'?390:0;this.clientHeight=id==='viewport'?844:0;this._textContent='';this.innerHTML=''; }
  appendChild(c){ if(c&&c.isFragment){for(const k of c.children)this.children.push(k);} else this.children.push(c); return c; }
  addEventListener(){} removeAttribute(){} setAttribute(){} setPointerCapture(){}
  getBoundingClientRect(){return{left:0,top:0,right:this.clientWidth,bottom:this.clientHeight,width:this.clientWidth,height:this.clientHeight};}
  querySelector(){return null;} querySelectorAll(){return [];} focus(){} blur(){} click(){} getContext(){return {};}
  set textContent(v){this._textContent=String(v); if(v==='')this.children.length=0;} get textContent(){return this._textContent;}
}
function makeCtx(){
  const els=new Map();
  const get=id=>{ let e=els.get(id); if(!e){e=new FakeElement(id);els.set(id,e);} return e; };
  const document={ body:new FakeElement('body','body'), getElementById:get, querySelector:()=>null, querySelectorAll:()=>[], createElement:t=>new FakeElement('',t), createDocumentFragment(){const f=new FakeElement('','#fragment');f.isFragment=true;return f;}, addEventListener(){}, documentElement:new FakeElement('html','html') };
  const c={ console, document, navigator:{userAgent:'x',userAgentData:{mobile:false}}, setTimeout, clearTimeout, requestAnimationFrame:cb=>setTimeout(cb,0), performance:{now:()=>0} };
  c.window=c; c.window.matchMedia=()=>({matches:false}); c.window.addEventListener=()=>{}; c.window.getSelection=()=>({removeAllRanges(){}}); c.globalThis=c;
  return c;
}
function loadApi(){
  const html=fs.readFileSync(path.join(rootDir,'index.html'),'utf8');
  const m=html.match(/<script>([\s\S]*)<\/script>/);
  const context=makeCtx();
  vm.runInNewContext(m[1], context, {filename:'index.html'});
  return context.window.__lorTest;
}

// ---- config ---------------------------------------------------------------
const GAMES = Number(process.argv[2]) || 6;
const TURNS = Number(process.argv[3]) || 120;
const SEED0 = 0x5eed1234;
const STUCK_TURNS = 4;   // sitting still this many consecutive turns = "stuck"

// classify why a still actor didn't move, from its diagnostic record
function heroWhy(a) {
  if (a.atCastle) return 'at-castle (resting/shopping)';
  if (a.atLair) return 'pinned: demolishing lair';
  if (a.threats > 0 && !a.fleeing) return 'pinned: melee lock';
  if (a.goalType === null) return 'no goal chosen (no valid path?)';
  if (a.pathLen === 0) return 'goal but empty path (reached target / blocked)';
  if (a.tile === 'MOUNTAIN') return 'standing on MOUNTAIN';
  if (a.needsRest && a.distCastle > 0) return 'wounded, cannot/slow to retreat';
  return `has goal=${a.goalType} pathLen=${a.pathLen} but not advancing`;
}
function hostileWhy(h) {
  if (!h.awake) return 'asleep (no actor/castle in wake radius)';
  if (h.pinned) return 'pinned: melee lock';
  if (h.goalType === null) return 'no goal';
  if (h.pathLen === 0) return 'goal but empty path';
  if (h.tile === 'MOUNTAIN') return 'standing on MOUNTAIN';
  return `has goal=${h.goalType} pathLen=${h.pathLen} but not advancing`;
}

const api = loadApi();
const stuckEvents = [];       // {seed, kind:'hero'|'hostile', who, fromTurn, len, whys:Map}
const whyTally = new Map();   // why -> count of stuck episodes

for (let g = 0; g < GAMES; g++) {
  const seed = (SEED0 + g * 0x9e3779b1) >>> 0;
  api.newGame(seed, { policy: 'balanced' });
  // history per actor id: {x,y,sameLen, startTurn, whys:[]}
  const hist = new Map();
  for (let t = 0; t < TURNS; t++) {
    api.stepTurn();
    const snap = api.snapshot();
    if (snap.gameOver) break;
    const state = api._actors();
    if (!state) break;
    const seenIds = new Set();
    const all = [
      ...state.heroes.map(a => ({ ...a, _kind: 'hero' })),
      ...state.hostiles.map(h => ({ ...h, _kind: 'hostile' })),
    ];
    for (const a of all) {
      seenIds.add(a.id);
      const prev = hist.get(a.id);
      const why = a._kind === 'hero' ? heroWhy(a) : hostileWhy(a);
      if (prev && prev.x === a.x && prev.y === a.y) {
        prev.sameLen++;
        prev.whys.push(why);
        // At the moment a hostile crosses the stuck threshold, snapshot WHY:
        // is it truly stranded (no reachable goal) or just looping in place?
        if (a._kind === 'hostile' && prev.sameLen === STUCK_TURNS && prev.diag === undefined) {
          const d = api._hostileDiag(a.id);
          if (d) {
            const reachable = d.cands.filter(c => c.pathLen >= 2).length;
            prev.diag = { raider: d.raider, reachable, nCands: d.nCands,
              castleReach: d.pathToCastleLen >= 2, season: d.season, tile: d.tile };
          } else prev.diag = null;
        }
      } else {
        // moved (or first sighting): close out a prior stuck episode
        if (prev && prev.sameLen >= STUCK_TURNS) recordStuck(seed, a._kind, prev);
        hist.set(a.id, { x: a.x, y: a.y, sameLen: 1, startTurn: state.turn, whys: [why], name: a.name || a.kind, role: a.role || a.kind, tile: a.tile, _kind: a._kind });
      }
    }
    // actors that died/despawned: flush
    for (const [id, prev] of hist) {
      if (!seenIds.has(id)) {
        if (prev.sameLen >= STUCK_TURNS) recordStuck(seed, prev._kind || 'hero', prev);
        hist.delete(id);
      }
      // (prev._kind set when the episode began)
    }
  }
  // flush remaining at game end
  for (const prev of hist.values()) if (prev.sameLen >= STUCK_TURNS) recordStuck(seed, prev._kind || 'hero', prev);
}

const tileTally = new Map();
function recordStuck(seed, kind, prev) {
  const dominant = mode(prev.whys);
  stuckEvents.push({ seed, kind, who: `${prev.name}/${prev.role}`, at: `${prev.x},${prev.y}`, fromTurn: prev.startTurn, len: prev.sameLen, why: dominant, tile: prev.tile, diag: prev.diag });
  whyTally.set(dominant, (whyTally.get(dominant) || 0) + 1);
}
function mode(arr) {
  const m = new Map(); for (const v of arr) m.set(v, (m.get(v) || 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1])[0][0];
}

// ---- report ---------------------------------------------------------------
// "Expected" stalls (not bugs): wild monsters dormant until something nears
// them, and heroes parked at the keep to rest/shop. Everything else is a
// genuine "can't make progress" stall worth investigating.
const EXPECTED = new Set([
  'asleep (no actor/castle in wake radius)',
  'at-castle (resting/shopping)',
]);
const genuine = stuckEvents.filter(e => !EXPECTED.has(e.why));
console.log(`Stuck-actor probe: ${GAMES} games x ${TURNS} turns, threshold >= ${STUCK_TURNS} turns on one tile\n`);
console.log(`Total stuck episodes: ${stuckEvents.length}  (expected/by-design: ${stuckEvents.length - genuine.length}, genuine: ${genuine.length})\n`);
console.log('All causes:');
for (const [why, n] of [...whyTally.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(n).padStart(4)}  ${EXPECTED.has(why) ? '(ok) ' : '     '}${why}`);
}
// Hero/guard breakdown — INCLUDING the "expected" causes, since a hero parked
// at the keep for many turns still reads visually as "stalling".
const heroStalls = stuckEvents.filter(e => e.kind === 'hero');
console.log(`\nHERO/GUARD stalls (all causes, incl. at-castle): ${heroStalls.length}`);
const heroWhyTally = new Map();
for (const e of heroStalls) heroWhyTally.set(e.why, (heroWhyTally.get(e.why) || 0) + 1);
for (const [why, n] of [...heroWhyTally.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(n).padStart(4)}  ${EXPECTED.has(why) ? '(was hidden) ' : '             '}${why}`);
}
console.log('  longest hero stalls:');
for (const e of [...heroStalls].sort((a, b) => b.len - a.len).slice(0, 10)) {
  console.log(`    ${e.who.padEnd(20)} @${e.at.padEnd(8)} ${e.tile.padEnd(7)} turns ${e.fromTurn}+${e.len}  [${e.why}]`);
}

console.log(`\nGENUINE stalls: ${genuine.length}  (heroes ${genuine.filter(e=>e.kind==='hero').length}, hostiles ${genuine.filter(e=>e.kind==='hostile').length})`);
const gTiles = new Map();
for (const e of genuine) gTiles.set(e.tile, (gTiles.get(e.tile) || 0) + 1);
console.log('Genuine stalls by tile they are stuck on:');
for (const [tile, n] of [...gTiles.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(4)}  ${tile}`);

// Stranded (a real bug: zero reachable goal candidates) vs loitering (has
// reachable candidates but its utility max is its own tile, so it dances back).
const hostileGenuine = genuine.filter(e => e.kind === 'hostile' && e.diag);
const stranded = hostileGenuine.filter(e => e.diag.reachable === 0);
const loitering = hostileGenuine.filter(e => e.diag.reachable > 0);
console.log(`\nHostile genuine stalls classified (${hostileGenuine.length} with diag):`);
console.log(`  STRANDED (0 reachable candidates -> truly frozen): ${stranded.length}`);
console.log(`     of which raiders: ${stranded.filter(e=>e.diag.raider).length}, castle-unreachable: ${stranded.filter(e=>!e.diag.castleReach).length}`);
console.log(`     stuck during winter: ${stranded.filter(e=>e.diag.season==='winter').length}, summer: ${stranded.filter(e=>e.diag.season==='summer').length}`);
console.log(`  LOITERING (has reachable candidates -> loops back to home tile): ${loitering.length}`);
console.log(`     of which raiders: ${loitering.filter(e=>e.diag.raider).length}`);
console.log('Longest genuine stalls:');
for (const e of [...genuine].sort((a, b) => b.len - a.len).slice(0, 25)) {
  console.log(`  ${e.kind.padEnd(7)} ${e.who.padEnd(22)} @${e.at.padEnd(8)} turns ${e.fromTurn}+${e.len}  [${e.why}]`);
}
