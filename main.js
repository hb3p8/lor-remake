// Simple tilemap renderer.
// Each map cell holds a single sprite name. Large sprites (castles, mountains,
// river bends) are drawn anchored at the cell center and may visually overflow
// into neighboring cells — the map data leaves blank grass around them.

const TILE = 60;
const COLS = 16;
const ROWS = 12;

const canvas = document.getElementById('map');
const ctx = canvas.getContext('2d');
canvas.width = TILE * COLS;
canvas.height = TILE * ROWS;

const status = document.getElementById('status');
const mapSelect = document.getElementById('map-select');
const reseedBtn = document.getElementById('reseed');
const gridBtn = document.getElementById('toggle-grid');

// Sprite groups: each map character resolves to one variant from a group.
const GROUPS = {
  forest: ['patch_a', 'patch_b', 'patch_c', 'patch_d', 'patch_e',
           'patch_f', 'patch_g', 'patch_h', 'patch_i', 'patch_j'],
  tree:   ['forest_a', 'forest_b', 'forest_c', 'forest_d', 'forest_e', 'forest_f',
           'tree_a', 'tree_b', 'tree_c', 'tree_tall', 'pine_a'],
  bush:   ['pine_b', 'tree_a', 'tree_b'],
  grass:  ['grass_a', 'grass_b', 'grass_c'],
  field:  ['field_a', 'field_b', 'field_c', 'field_d',
           'field_e', 'field_f', 'field_g'],
  house:  ['house_a', 'house_b', 'house_c', 'house_d', 'house_e', 'house_f'],
  village:['village_a', 'village_b', 'village_c'],
  church: ['church_a', 'church_b', 'church_c'],
  cathedral: ['cathedral'],
  windmill:  ['windmill'],
  castle:    ['castle_b', 'castle_big', 'castle_c'],
  tower:     ['castle_a'],
  walled:    ['walled_camp', 'gated_keep'],
  mountain:  ['mtn_a', 'mtn_b', 'mtn_c', 'mtn_d', 'mtn_e', 'mtn_f'],
  bigmtn:    ['mtn_big', 'mtn_range'],
  river:     ['river_a'],
  bend:      ['river_bend', 'river_bend_b'],
};

// Map glyph → group name.
const CHAR_TO_GROUP = {
  '.': null,         // bare grass
  ',': 'grass',      // grass with sparse decoration
  'f': 'forest',     // forest patch
  't': 'tree',
  'b': 'bush',
  'W': 'field',
  'h': 'house',
  'v': 'village',
  'c': 'church',
  '+': 'cathedral',
  '$': 'windmill',
  'K': 'castle',
  'I': 'tower',
  '#': 'walled',
  'm': 'mountain',
  'M': 'bigmtn',
  '~': 'river',
  'r': 'bend',
};

// Hand-authored sample maps. Each row is COLS=16 chars.
const MAPS = {
  'Countryside': [
    'fffttt,........r',
    'ff.t.t....t~~~~~',
    '.f...,....r.....',
    '...,h.h.....,...',
    '..,hch.....t....',
    '...hh,..,.......',
    '..,...WWW..,.t..',
    '..t...WWW....,..',
    '...$..WWW...,...',
    'mm....,......,..',
    'Mmm.,......t.K..',
    'mmm..bb.....,...',
  ],
  'Border march': [
    'MMMmmmm.....ttff',
    'MM,mm,.....tffff',
    'Mm....t.,..tff..',
    'mm.....,..,.....',
    '..t..#......,..,',
    '...,......r~~~~~',
    '...,.h.v.r.,....',
    '..h,hc,.,.......',
    '..hh..,...,..,..',
    '...,WWW.....,...',
    'tt..WWW..,..K...',
    'tff..$....,.,...',
  ],
  'Kingdom view': [
    'tt..K.,.....mm..',
    'ttf,,,.....Mmmmm',
    'tff..,..,..mmm..',
    '...,..h.....,...',
    '..,h+hh.,.......',
    '..,hhh......I...',
    '....,.....,.....',
    '..WW.,.......,..',
    '..WW...#........',
    '.$.....,..,.....',
    '..,..r~~~~~~~~~~',
    '..t..r..........',
  ],
};

// ─── sprite loading ────────────────────────────────────────────────
const sprites = {};
function loadSprite(name) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => { sprites[name] = img; resolve(); };
    img.onerror = () => reject(new Error('failed: ' + name));
    img.src = 'tiles/' + name + '.png';
  });
}

async function loadAll() {
  const names = new Set();
  for (const g of Object.values(GROUPS)) g.forEach(n => names.add(n));
  await Promise.all([...names].map(loadSprite));
}

// ─── deterministic PRNG so reseed produces stable maps ─────────────
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

let rand = mulberry32(1);
let currentMap = 'Countryside';
let showGrid = false;

function pick(group) {
  const list = GROUPS[group];
  return list[Math.floor(rand() * list.length)];
}

// ─── rendering ─────────────────────────────────────────────────────
function fillGrassBase() {
  // Soft vertical gradient + subtle pixel noise.
  const g = ctx.createLinearGradient(0, 0, 0, canvas.height);
  g.addColorStop(0, '#5e7c3c');
  g.addColorStop(1, '#566f33');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const r = mulberry32(99);
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (r() - 0.5) * 14;
    d[i]   = Math.max(0, Math.min(255, d[i]   + n));
    d[i+1] = Math.max(0, Math.min(255, d[i+1] + n));
    d[i+2] = Math.max(0, Math.min(255, d[i+2] + n));
  }
  ctx.putImageData(img, 0, 0);
}

function drawSprite(name, cx, cy) {
  const img = sprites[name];
  if (!img) return;
  // Anchor at the cell's center-bottom so taller sprites grow upward
  // (mountains, castles, churches read better with bottom-anchored placement).
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  ctx.drawImage(img, Math.round(cx - w / 2), Math.round(cy - h / 2));
}

function drawGrid() {
  ctx.strokeStyle = 'rgba(255,255,255,0.08)';
  ctx.lineWidth = 1;
  for (let x = 0; x <= COLS; x++) {
    ctx.beginPath();
    ctx.moveTo(x * TILE + 0.5, 0);
    ctx.lineTo(x * TILE + 0.5, canvas.height);
    ctx.stroke();
  }
  for (let y = 0; y <= ROWS; y++) {
    ctx.beginPath();
    ctx.moveTo(0, y * TILE + 0.5);
    ctx.lineTo(canvas.width, y * TILE + 0.5);
    ctx.stroke();
  }
}

function renderMap(name) {
  const rows = MAPS[name];
  if (!rows) return;

  fillGrassBase();

  // Two passes so taller features (mountains, castles) draw on top of
  // anything in the row above them.
  const placements = [];
  for (let y = 0; y < rows.length; y++) {
    const row = rows[y];
    for (let x = 0; x < row.length; x++) {
      const ch = row[x];
      const group = CHAR_TO_GROUP[ch];
      if (!group) continue;
      placements.push({ x, y, sprite: pick(group) });
    }
  }
  // Paint back-to-front by y so southern features overlap northern ones.
  placements.sort((a, b) => a.y - b.y);
  for (const p of placements) {
    const cx = p.x * TILE + TILE / 2;
    const cy = p.y * TILE + TILE / 2;
    drawSprite(p.sprite, cx, cy);
  }

  if (showGrid) drawGrid();
}

// ─── ui ────────────────────────────────────────────────────────────
for (const name of Object.keys(MAPS)) {
  const opt = document.createElement('option');
  opt.value = name; opt.textContent = name;
  mapSelect.appendChild(opt);
}
mapSelect.value = currentMap;

mapSelect.addEventListener('change', () => {
  currentMap = mapSelect.value;
  rand = mulberry32(1);
  renderMap(currentMap);
});
reseedBtn.addEventListener('click', () => {
  rand = mulberry32(Math.floor(Math.random() * 1e9));
  renderMap(currentMap);
});
gridBtn.addEventListener('click', () => {
  showGrid = !showGrid;
  renderMap(currentMap);
});

loadAll().then(() => {
  status.textContent = `loaded ${Object.keys(sprites).length} sprites`;
  renderMap(currentMap);
}).catch(err => {
  status.textContent = String(err);
});
