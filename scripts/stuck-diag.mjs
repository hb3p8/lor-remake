// Reproduce one long stuck awake-hostile stall and dump WHY: its candidate
// list with pathfinding results.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
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
  const els=new Map(); const get=id=>{ let e=els.get(id); if(!e){e=new FakeElement(id);els.set(id,e);} return e; };
  const document={ body:new FakeElement('body','body'), getElementById:get, querySelector:()=>null, querySelectorAll:()=>[], createElement:t=>new FakeElement('',t), createDocumentFragment(){const f=new FakeElement('','#fragment');f.isFragment=true;return f;}, addEventListener(){}, documentElement:new FakeElement('html','html') };
  const c={ console, document, navigator:{userAgent:'x',userAgentData:{mobile:false}}, setTimeout, clearTimeout, requestAnimationFrame:cb=>setTimeout(cb,0), performance:{now:()=>0} };
  c.window=c; c.window.matchMedia=()=>({matches:false}); c.window.addEventListener=()=>{}; c.window.getSelection=()=>({removeAllRanges(){}}); c.globalThis=c; return c;
}
const html=fs.readFileSync(path.join(rootDir,'index.html'),'utf8');
const m=html.match(/<script>([\s\S]*)<\/script>/);
const context=makeCtx();
vm.runInNewContext(m[1], context, {filename:'index.html'});
const api=context.window.__lorTest;

const seed = (0x5eed1234 + 0 * 0x9e3779b1) >>> 0;
api.newGame(seed, { policy: 'balanced' });
const lastPos = new Map(); const stuckLen = new Map();
let target = null;
for (let t = 0; t < 120 && !target; t++) {
  api.stepTurn();
  if (api.snapshot().gameOver) break;
  const st = api._actors();
  for (const h of st.hostiles) {
    const k = h.id, key = h.x + ',' + h.y;
    if (lastPos.get(k) === key) stuckLen.set(k, (stuckLen.get(k) || 1) + 1);
    else { stuckLen.set(k, 1); lastPos.set(k, key); }
    // first awake hostile stuck >=8 turns with no goal, on a PASSABLE tile
    if (h.awake && h.goalType === null && (stuckLen.get(k) || 0) >= 8
        && h.tile !== 'WATER' && h.tile !== 'DEEP' && h.tile !== 'MOUNTAIN') { target = { id: k, turn: st.turn, h }; break; }
  }
}
if (!target) { console.log('no qualifying stall found in this game'); process.exit(0); }
console.log(`Stuck hostile ${target.h.kind} id=${target.id} at ${target.h.x},${target.h.y} (tile ${target.h.tile}) on turn ${target.turn}, stuck ${stuckLen.get(target.id)} turns\n`);
const diag = api._hostileDiag(target.id);
console.log(`raider=${diag.raider} season=${diag.season} origin=${diag.origin.x},${diag.origin.y} territory=${diag.territory} awake=${diag.awake} candidates=${diag.nCands}`);
console.log(`findPath(this -> castle) length = ${diag.pathToCastleLen}  (0 = castle UNREACHABLE from here)`);
console.log('candidates (sorted by utility):');
for (const c of diag.cands) {
  console.log(`  ${c.type.padEnd(6)} ->(${c.tx},${c.ty}) util=${String(c.util).padStart(4)} pathLen=${c.pathLen}${c.self ? '  <-- SELF (own tile)' : ''}${c.pathLen >= 2 ? '  REACHABLE' : (c.pathLen <= 1 ? '  unreachable/self' : '')}`);
}
const reachable = diag.cands.filter(c => c.pathLen >= 2);
console.log(`\n${reachable.length} of ${diag.cands.length} candidates are reachable (pathLen>=2).`);
if (reachable.length === 0) console.log('=> chooseHostileGoal sets goal=null => the hostile never moves.');
