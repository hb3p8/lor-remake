# Implementation Plan Proposal - Villages and Caravans

Villages are the next expansion layer: the player spends stored food and coin to
found an outlying settlement on a known reachable tile, then protects that
settlement and its resource carts. This adds a territorial economy without
returning to worker micromanagement.

Status: approved with locked decisions (see section 0). Grounded against the
current `index.html` state after the hero gold loop, bounties, market potions,
ruin delving, and beast taming are already in place.

---

## 0. Locked decisions (post-review)

These override anything below them.

1. **Stalling discipline.** Carts and any protection AI are the top stall risk
   (we just spent several passes killing stranded/loitering/parked-hero stalls).
   - Carts get **cart-specific recovery**, NOT the generic stranded-actor
     teleport-to-keep: a cart that cannot make progress to the castle for a few
     turns is **abandoned (despawned), its payload lost**. Exclude `cart` actors
     from the generic stranded-recovery branch.
   - **Protection goals (`escortCart`/`protectVillage`) are deferred.** Phase
     one relies on existing hostile-aggro, the bounty system, and hero combat.
     Add protection only if the harness shows villages/carts are too fragile.
2. **Generalized rest/heal.** Rest sites become "castle OR alive village." The
   recent keep fixes must be generalized: a hero standing on *any* rest-site
   tile heals for free (the on-tile heal, not only goal arrival), and
   `resolveGoalArrival` heals at any rest site. Otherwise the wounded-hero-parked
   -on-tile stall returns at villages.
3. **Season-proof infrastructure.** Founding eligibility, the link path, and road
   carving use **summer (base) terrain costs**, never the current season. A road
   may never be routed/carved over seasonally-frozen water; water crossings on a
   route become `BRIDGE`, never `ROAD`. Carts caught on a tile that thaws to
   impassable are abandoned by the cart recovery rule.
4. **Coin-biased economy.** Villages are primarily a **coin** source for now.
   Village **food production is low and goes to 0 in winter** (consistent with
   `FARM_SEASON_FOOD_MUL.winter = 0`). This keeps villages from trivializing the
   food → population → castle-tier gate. Yield model below is re-biased to coin.
5. **Front-loaded Steward.** A minimal "Steward founds one village when food is
   high and a safe, affordable, reachable site exists" lands right after 11b, so
   carts/raids/decay (11c+) get real harness signal instead of shipping blind.
6. **Anchor-chain road persistence.** A road segment lives as long as it lies on
   the path-to-castle of *some* living village. A village refs **every road cell
   on its full chain to the castle**, not just its own hop. If a mid-chain
   village is destroyed, its **settlement tile reverts to `ROAD`** (it is still a
   waypoint for a downstream village) and the whole road survives as long as the
   chain-end village lives. Only cells referenced by no living village decay.
7. **Dead code first.** Before any village work, remove the vestigial/broken
   `cargoFood`/`cargoWood`/`deliver`/`resupply` system and the non-functional
   `supply` system (heroes are never given `supply`, so it is `NaN`; no
   `resupply` goal is ever generated). This simplifies the rest-site
   generalization and removes the supply checks the cart model had to dodge.
8. **Founding UX.** Do not open a panel on every empty-tile tap. Founding is an
   explicit action: a **long-press** on a known tile (mobile) / right-click or a
   "found village" toggle (desktop) opens the tile/founding view. A normal tap
   keeps its current highlight behavior.

---

## 1. Goal

Add a compact loop:

```text
 food + coin -> found village on known reachable tile
 village -> slowly earns food + coin
 village -> sends a cart to castle
 protected cart reaches castle -> castle gains food + coin
 raiders reach village or cart -> resources are lost, village may be destroyed
```

Design intent:
- Villages are a strategic expansion sink for mid/late food.
- They make geography matter: good sites, road length, and defense coverage
  affect payoff.
- They add vulnerable economic traffic without creating worker assignment UI.
- They extend hero logistics by providing visibility and rest/heal points away
  from the castle.

Keep scope small. No village buildings, no village upgrade tree, no village
population, no manual cart control.

---

## 2. Current code state

Relevant current seams:

- `makeGameState()` has `actors`, `hostiles`, `lairs`, bounties, hero gold
  fields, but no `villages`, `carts`, player-built roads, or owned fields.
- The map already has generated `TOWN` tiles and nearby `FARM` blobs from map
  generation. They are mostly cosmetic today. Villages should replace that
  system: either reuse the `TOWN` tile key for founded villages, or rename the
  key to `VILLAGE` and update all existing `TOWN` generation/rendering paths.
  Do not keep a parallel cosmetic-town system plus a gameplay-village system.
- `TOWN` is already in `ROADS` and has road-like travel cost. This makes reusing
  the existing tile key the lowest-risk implementation path if the visual glyph
  remains acceptable.
- Existing panel views are full-screen overlays driven by `viewMode`,
  `PANEL_VIEWS`, `panelHotspots`, `render*View()`, and `handleGridClick()`.
  Current panel views include city, report, actor, enemy, tile-bounty, lair, and
  gameover.
- Clicking a known empty map tile currently only highlights it. Unknown tiles
  open the scouting bounty view; castle opens city; actors/enemies/lairs open
  dedicated views.
- `findPath(actor, target)` is reusable and already uses typed scratch buffers.
  It does not require all path cells to be discovered, so founding needs a
  stricter "known path" check or a post-filter over the returned path.
- `updateVisibility()` reveals around the castle and actors only. Villages must
  be added as persistent vision sources.
- `hostileIsAwake()` currently wakes hostiles near the castle or actors. Its
  comment already mentions villages, but the code does not. Villages should wake
  nearby hostiles once implemented.
- `isStackable()` only allows stacking at the castle. Village rest sites need to
  become stackable for friendly actors.
- `resolveGoalArrival()` handles rest/flee at the castle and delve goals. It
  should support rest/flee at any safe haven, including villages.
- `resolveSiege()` only handles raiders adjacent to the castle. Village raids
  need a separate resolution path or a generalized settlement raid function.
- `game.actors` is the easiest place to put carts because hostiles already chase
  and fight actors. Carts must get explicit `supply`/`maxSupply` fields to avoid
  interacting badly with existing supply checks.

---

## 3. Core model

### 3.1 Village entity

Add `game.villages = []` and `game.villageSeq = 0`.

Village object:

```js
{
  id,
  name,
  x, y,
  alive: true,
  hp,
  maxHp,
  foundedTurn,
  anchorId,          // "castle" or another village id
  roadCells,         // cells carved for this village's connection
  fieldCells,        // nearby farms owned by this village
  tileOriginal,      // original terrain under the village tile
  foodRate,
  coinRate,
  storedFood,
  storedCoin,
  cartTimer,
  activeCartId: null,
  raidsSurvived: 0,
}
```

Tile key recommendation: reuse `TOWN` for the village tile in the first pass,
but rename its display name to "village" and make gameplay ownership come from
`game.villages`, not from raw terrain. This keeps existing road coloring,
pathing, legend, and hostile road preference behavior working with less churn.

If the code is renamed instead, do it as a full terrain rename:
- replace `TOWN` with `VILLAGE` in `T`, `ROADS`, winter palette, legend order,
  map generation, road carving, hostile preferences, and any tile labels;
- remove or disable the old generated-town placement so cosmetic towns do not
  remain as unrelated road nodes.

Do not support both `TOWN` and `VILLAGE` as separate settlement tiles in the
same first pass. The feature is clearer if founded villages are the settlement
terrain.

Generator issue: current `TOWN` sites are also MST road endpoints. Removing
cosmetic towns must not accidentally erase all road structure. Minimal approach:
keep neutral road waypoint sites during generation if the map needs them, but do
not stamp `TOWN`/`FARM` for non-player settlements. Founded villages become the
only non-castle settlement tiles.

### 3.2 Cart actor

Use `game.actors` for carts:

```js
{
  id: `cart-${seq}`,
  role: 'cart',
  cart: true,
  villageId,
  name: 'Village Cart',
  glyph: 'c',
  fg,
  x, y,
  maxHp: 8,
  hp: 8,
  ac: 10,
  atk: 0,
  dmg: { n: 1, d: 1, mod: -1 },
  vision: 1,
  steps: 4.0,
  supply: 999,
  maxSupply: 999,
  foodPayload,
  coinPayload,
  alive: true,
  goal: null,
  fleeing: false,
}
```

Add cart-specific goal generation:
- cart always targets the castle with `type: 'deliver'`;
- on arrival, deposit payload into `game.food` and `game.coin`, clear the
  village's `activeCartId`, then remove/mark the cart dead;
- if killed, payload is lost and the village can launch another cart after the
  next interval.

Potential issue: carts will make weak melee attacks when adjacent because the
combat system assumes every actor can strike. That is acceptable for now if the
damage is effectively 1 at most. A later pass can add "noncombat actor" combat
rules if cart fights look silly.

---

## 4. Founding rules

### 4.1 Eligibility

Add:

- `villageAt(x, y)`
- `villageAnchorSites()`
- `nearestVillageAnchor(x, y)`
- `villageSitePreview(x, y)`
- `canFoundVillageAt(x, y)`
- `foundVillageAt(x, y)`

A tile is eligible when:
- it is discovered;
- it is passable in the current season;
- it is road-passable: terrain cost is finite for road/path construction, and
  road carving can legally connect to it without crossing permanent blockers;
- it is reachable from the nearest alive village or the castle;
- the known path from that anchor to the tile is at most
  `VILLAGE_MAX_LINK_DIST`;
- the path does not cross undiscovered cells;
- no actor, hostile, lair, castle, or existing village occupies the tile;
- the terrain is allowed.

Initial allowed terrain:
- good: `PLAINS`, `GRASS`;
- allowed but lower yield: `FOREST`, `HILL`, `ROAD`;
- disallowed: water/deep water, river, mountain/peak, swamp, deepwood, ruin,
  bridge, castle, existing village/`TOWN`, and existing `FARM`.

Existing `FARM` is not a valid village founding tile. Farms are owned support
tiles, not settlement centers, and allowing founding on them would make field
ownership/destruction ambiguous.

Do not allow founding in fog. The player can use scouting bounties first.

### 4.2 Range and path

Use path distance rather than raw Manhattan distance for the actual rule. The
proposal wording says "closer than max distance from nearest village or castle",
but geography matters here, and path distance avoids founding across rivers or
mountains that only look close.

Implementation options:
- run `findPath()` from each anchor to the candidate tile on tap;
- choose the shortest path whose cells are all discovered;
- cache only the last preview, because this runs on user taps and is not a
  per-turn hot path.

Recommended constants:

```js
const VILLAGE_MAX_LINK_DIST = 28;       // path steps, not cost
const VILLAGE_MIN_SPACING = 6;          // from any alive village
const VILLAGE_FOUND_FOOD_BASE = 170;
const VILLAGE_FOUND_COIN_BASE = 80;
const VILLAGE_FOUND_FOOD_PER_PATH = 3;
const VILLAGE_FOUND_COIN_PER_PATH = 1;
const VILLAGE_MAX_COUNT = 4;
```

Cost formula:

```js
foodCost = VILLAGE_FOUND_FOOD_BASE + pathLen * VILLAGE_FOUND_FOOD_PER_PATH;
coinCost = VILLAGE_FOUND_COIN_BASE + pathLen * VILLAGE_FOUND_COIN_PER_PATH;
```

This makes villages expensive enough to compete with castle upgrades and hero
infrastructure, while still letting nearby sites be affordable first.

### 4.3 Yield preview

Compute `foodRate` and `coinRate` from a radius-3 local scan around the site.
Keep it integer and cheap. Score nearby fieldable terrain rather than existing
`FARM` tiles, because founding will create its own owned fields.

Suggested first pass (coin-biased per locked decision 4):

```js
// Coin is the point; food is a small bonus that disappears in winter.
coinRate =
  2
  + nearbyRoadOrSettlementCount * 0.35
  + ruinNearbyBonus
  + distanceFromCastle * 0.04;

foodRate =
  1
  + fieldablePlainGrassCount * 0.15
  + woodsCount * 0.08;
```

Clamp (coin headroom, food kept modest):

```js
coinRate = clamp(round(coinRate), 2, 9);
foodRate = clamp(round(foodRate), 1, 4);
```

Winter zeroes village food before payload is computed (mirror
`FARM_SEASON_FOOD_MUL.winter = 0`); coin is unaffected.

Preview should show:
- founding cost;
- link path length;
- cart interval;
- expected cart payload, e.g. `about 24 food / 18 coin every 6 turns`;
- risk note from nearby visible hostile/lair count if cheap to compute.

Do not make the preview a perfect promise if winter/raids can interrupt carts.
Phrase it as "would earn" or "expected cart".

---

## 5. Tile and village views

### 5.1 Known tile details

Add `selectedTile = null`, `viewMode = 'tile'`, `renderTileView()`, and include
`tile` in `PANEL_VIEWS`.

Click behavior changes:
- unknown tile: keep existing `tilebounty` view;
- known village tile: open `village` view;
- known empty tile: open `tile` view;
- known actor/hostile/lair still takes precedence.

The tile view should be dense and mobile-safe:

```text
< BACK TO MAP
----------------
TILE DETAILS

32,18 PLAINS
Known, reachable

VILLAGE SITE
Cost 236f 102c
Cart 24f 18c / 6 turns
Road 22 tiles from castle

[ Found village here ]
```

If invalid, show a short reason:
- unknown;
- too far from nearest settlement;
- no known route;
- not road-passable this season;
- blocked by lair/hostile/unit;
- unsuitable terrain;
- existing farm/field;
- max villages reached;
- not enough food/coin.

Register a panel hotspot for `foundVillage`.

### 5.2 Village details

Add `selectedVillage = null`, `viewMode = 'village'`, `renderVillageView()`.

Village view:

```text
< BACK TO MAP
----------------
VILLAGE

OAKFORD  32,18
HP 18/24
Earns 4f 3c / turn
Stores 12f 9c
Cart in 2 turns
Road 22 tiles

No local building options yet.
```

If a cart is active:

```text
Cart en route: 24f 18c
```

No action buttons for now except back. A later phase can add "post guard bounty"
or village buildings.

---

## 6. Village footprint, fields, and roads

Founding a village should:
- replace the destination tile with the settlement tile (`TOWN` if reused,
  `VILLAGE` if renamed);
- stamp nearby owned `FARM` fields using the same style as current generated
  town/castle fields;
- carve a road from its anchor to the village.

### 6.1 Fields

The current generator grows 2-4 `FARM` blobs around each settlement on
`PLAINS`/`GRASS`. Reuse that idea for founded villages, but make ownership
explicit:

```js
village.fieldCells = [];
game.playerFieldRefs = new Int16Array(COLS * ROWS);
game.playerFieldOriginal = Object.create(null); // cell -> original tile key
game.fieldDecay = [];
```

Field stamping:
- try a small number of deterministic attempts around the founded village;
- only consume `PLAINS`/`GRASS` cells that are discovered, road-passable, and not
  occupied by roads, settlements, ruins, lairs, actors, or hostiles;
- create 2-4 compact blobs with a small total cap, matching the current town
  field visual density;
- store original terrain for each converted field cell;
- increment field refs so overlapping future village fields are safe, even if
  overlap should be rare.

Fields are not separate production entities. They are the visible footprint that
helps explain `foodRate` and gives raiders something the player can lose.

When a village is destroyed:
- decrement refs for its `fieldCells`;
- cells whose ref reaches zero enter `fieldDecay`;
- use the same deterministic 1-6 big-turn decay window as roads;
- restore the stored original terrain if the cell is still unclaimed.

Potential issue: farms around the castle currently represent base castle food.
Do not attach castle fields to village ownership unless castle-field ownership
is generalized later.

### 6.2 Roads

Founding a village should carve a road from its anchor to the village.

Do not reuse the map-generation-only `astar()` nested inside map generation. It
is unavailable after generation. Use `findPath()` with a lightweight pseudo
actor or write a small `findKnownPathForVillage()` that reuses the path scratch
buffers and only allows discovered road-passable cells.

Road carving:
- for each path cell except the anchor and village tile:
  - `RIVER` becomes `BRIDGE`;
  - ordinary terrain becomes `ROAD`;
  - existing `ROAD`, `BRIDGE`, settlement tile, and `CASTLE` stay as-is;
- mark `game.caches.frontierDirty = 1` if discovered/open territory changed;
- add any new `ROAD`/`BRIDGE` cells to ownership bookkeeping.

Road ownership is important because roads can overlap:

```js
game.playerRoadRefs = new Int16Array(COLS * ROWS);
game.playerRoadOriginal = Object.create(null); // cell -> original tile key
game.roadDecay = [];
```

When carving:
- if a cell is not already player-built road, store original terrain;
- increment `playerRoadRefs[cell]`.

When a village is destroyed:
- decrement refs for its `roadCells`;
- only cells whose ref reaches zero enter road decay;
- never decay original map roads/bridges/towns/castle/villages.

Road degradation:
- schedule every unreferenced road cell to decay over roughly 6 big turns;
- use deterministic jitter from map seed, turn, and cell:

```js
dueTurn = game.turn + 1 + (hash(cell, game.turn) % 6);
```

Each big turn, process due cells and restore their original terrain if still
unclaimed. This gives the "slowly randomly degrading" feel without per-cell RNG
or full-map scans.

Potential issue: if a new village reuses a road cell while it is scheduled to
decay, cancel or ignore the decay because `playerRoadRefs[cell] > 0`.

Implementation tweak: use one shared decay helper for roads and fields so both
systems get the same deterministic timing, ref-count check, and restoration
safety.

---

## 7. Economy and carts

### 7.1 Village production

In `bigTurnEconomy()` after `economyTick()` and before raids/lairs, tick
villages:

```js
function tickVillages(events) {
  for each alive village:
    storedFood += foodRate;
    storedCoin += coinRate;
    cartTimer--;
    if cartTimer <= 0 && !activeCartId && (storedFood || storedCoin):
      spawnVillageCart(village)
      cartTimer = VILLAGE_CART_INTERVAL
}
```

Recommended constants:

```js
const VILLAGE_CART_INTERVAL = 6;
const VILLAGE_CART_MIN_FOOD = 8;
const VILLAGE_CART_MIN_COIN = 8;
```

Spawn payload:
- `foodPayload = Math.floor(v.storedFood)`;
- `coinPayload = Math.floor(v.storedCoin)`;
- subtract payload from village storage;
- skip spawn if both are below minimum.

This means a raided village can lose stored resources before they reach the
castle, and a blocked cart does not create a pileup.

### 7.2 Cart delivery

In `generateGoalCandidates(actor)`, handle `actor.cart` before guard/hero logic:
- target castle with `type: 'deliver'`;
- high utility;
- no rest/shop/explore behavior.

In `resolveGoalArrival()`:
- if `goal.type === 'deliver' && actor.cart`, add payload to `game.food` and
  `game.coin`;
- increment metrics;
- clear `activeCartId`;
- mark the cart dead or remove it from `game.actors` in a cleanup pass.

Add event:

```text
Oakford's cart reaches the keep (+24 food, +18 coin).
```

Potential issue: existing combat logs may show carts "fighting". If that feels
wrong, add a `noncombat` flag later so carts only take hits and never swing.

---

## 8. Protection and raids

### 8.1 Carts

Because carts are actors:
- hostiles can stalk them through existing hostile goal logic;
- adjacent combat can kill them;
- no special interception system is required for phase one.

Add cart death event:

```text
Oakford's cart is lost with its stores.
```

The payload is gone. Do not drop loot; otherwise raiders become a resource
source.

### 8.2 Lawful protection goals

Add a dedicated protection goal for lawful hero roles, starting with `ranger`
and `fighter`.

The goal is not a manual assignment UI. It is an extra candidate in
`generateGoalCandidates(actor)`:
- eligible actors: alive heroes with role `ranger` or `fighter`;
- not eligible if badly wounded, fleeing, shopping/resting urgently, or already
  adjacent to a visible enemy they should fight;
- protectable targets: alive villages with visible/nearby hostile pressure, and
  active carts from an alive village;
- goal types: `protectVillage` and `escortCart`;
- goal duration: short lived, e.g. `protectUntil = game.turn + 2` or until the
  cart reaches castle / village pressure clears.

Suggested behavior:
- `protectVillage`: move to the village or a nearby road/passable tile, then
  linger for a couple of big turns while normal combat targeting handles any
  raiders that approach;
- `escortCart`: move toward the cart or to the next road tile ahead of it, then
  re-evaluate frequently so the actor does not chase stale cart positions;
- rangers get a wider response radius because they are scouts and have better
  vision;
- fighters get higher utility when the threat count is high.

Keep utility conservative. Protection should help villages and carts feel
defensible, but it should not override explicit kill/lair bounties or turn every
hero into a permanent caravan guard.

Success criteria for this behavior:
- a nearby ranger/fighter sometimes shadows a cart or waits at a threatened
  village;
- actors still rest when hurt and still fight adjacent enemies;
- no actor remains stuck with a completed or destroyed cart/village target;
- path calls/turn do not climb meaningfully in the harness.

### 8.3 Villages

Villages are not actors in phase one. Resolve raids at the end of the big turn,
similar to `resolveSiege()`:

```js
function resolveVillageRaids(events) {
  for each alive village:
    raiders = adjacent evil hostiles
    defenders = alive heroes within VILLAGE_DEFENSE_RADIUS
    breached = max(0, raiders - defenders)
    damage village hp and/or stored resources
    if hp <= 0 destroyVillage(village)
}
```

Recommended constants:

```js
const VILLAGE_MAX_HP = 24;
const VILLAGE_RAID_DAMAGE = 8;
const VILLAGE_DEFENSE_RADIUS = 2;
```

Raid effects:
- first raid damage steals/destroys stored resources;
- repeated breaches reduce village HP;
- at 0 HP, destroy the village, remove its tile, and schedule road/field decay.

Should raiders deliberately target villages?

Yes, but keep it conservative:
- ordinary territorial evil hostiles can raid a village if it lies within their
  territory or pursuit leash;
- spawned raid waves should still mostly target the castle, but once villages
  exist, assign some waves to the nearest or richest village.

Minimal first pass:
- change `spawnRaidWave()` to choose a target from castle + alive villages:
  - castle remains default;
  - if villages exist, 30-40% of waves target a village;
  - set `hostile.raidTarget = { type: 'village', id }` on spawned raiders;
- `generateHostileGoalCandidates()` uses `raidTarget` when present, otherwise
  falls back to castle.

Potential issue: a village-targeted wave that destroys the village should not
become stuck. If its target is gone, redirect to castle or mark the raider's
goal null and let it re-evaluate.

---

## 9. Villages as rest and visibility sites

### 9.1 Visibility

In `updateVisibility()`:

```js
for each alive village:
  revealAround(v.x, v.y, VILLAGE_VISION_RADIUS)
```

Start with:

```js
const VILLAGE_VISION_RADIUS = 6;
```

Also update `hostileIsAwake()` so hostiles near villages stay simulated.

Risk: more persistent vision wakes more hostiles and increases pathfinding. This
is intended strategically but must be measured. The number of villages is capped
and low, so the visibility scan is cheap.

### 9.2 Rest and heal

Extend safe havens:

```js
function restSites() -> castle + alive villages
function nearestRestSite(actor) -> closest reachable safe haven
```

Use `nearestRestSite()` for:
- wounded `rest` goals;
- `ensureFleeGoal()`;
- idle rest fallback if useful.

`resolveGoalArrival()` should restore `hp`/`supply` at either castle or village.

Extend `isStackable(x, y)` to return true for castle or alive village tiles.

Potential issue: heroes may rest at doomed villages and get trapped. Initial
guardrail: do not choose a village rest site if an evil hostile is adjacent to
that village or if the village hp is below 30%.

---

## 10. Data model and snapshots

Add game fields:

```js
villages: [],
villageSeq: 0,
cartSeq: 0,
playerRoadRefs: new Int16Array(COLS * ROWS),
playerRoadOriginal: Object.create(null),
roadDecay: [],
playerFieldRefs: new Int16Array(COLS * ROWS),
playerFieldOriginal: Object.create(null),
fieldDecay: [],
villageStats: {
  founded: 0,
  destroyed: 0,
  cartsSent: 0,
  cartsDelivered: 0,
  cartsLost: 0,
  deliveredFood: 0,
  deliveredCoin: 0,
}
```

Add snapshot fields:
- `villagesAlive`
- `villagesFounded`
- `villagesDestroyed`
- `cartsActive`
- `cartsSent`
- `cartsDelivered`
- `cartsLost`
- `villageFoodDelivered`
- `villageCoinDelivered`
- per-village snapshot with x/y/hp/rates/stored/cart status/field count

Add sim-harness summary fields:
- avg villages founded/alive/destroyed;
- cart delivery rate;
- food/coin delivered by villages;
- carts lost;
- road/field decay count if useful;
- performance deltas.

---

## 11. Phased rollout

### 11a - Tile details and founding preview

Implement:
- `tile` view for known empty tiles;
- `villageSitePreview()`;
- eligibility/cost/yield preview;
- no actual founding yet.

Success criteria:
- known empty tiles open a details panel;
- unknown tiles still open scouting bounty view;
- actor/hostile/lair/castle click precedence remains unchanged;
- `FARM`, existing settlement tiles, and terrain that is not road-passable show
  explicit invalid reasons;
- preview reasons are stable and fit the mobile panel.

### 11b - Found village, fields, and road

Implement:
- village data model;
- `foundVillageAt()`;
- settlement tile reuse/rename;
- nearby owned field stamping;
- road carving and road ownership;
- village view with no build options.

Success criteria:
- founding spends the previewed food/coin;
- village appears on the map and opens village details;
- nearby fields appear using the existing generated-field visual style;
- a road appears from nearest anchor to village;
- founding cannot happen on invalid/undiscovered/unreachable tiles;
- founding does not allow existing `FARM` tiles;
- there is no parallel cosmetic generated-town system left behind.

Harness:

```sh
node scripts/sim-harness.mjs --games 10 --turns 100 --seed 1592594996
```

For 11b, behavior changes may be tiny unless the Steward is taught to found
villages. Parse/smoke is the main check.

### 11c - Village production and carts

Implement:
- village production tick;
- cart actor type and delivery goal;
- delivery/death cleanup;
- snapshot/harness metrics.

Success criteria:
- carts spawn every interval when a village has stored resources;
- carts path to the castle and deposit food/coin;
- killed carts lose their payload;
- no cart remains forever after delivery or death;
- carts do not corrupt hero/guard counts.

Harness additions:
- `cartsSent`, `cartsDelivered`, `cartsLost`;
- `villageFoodDelivered`, `villageCoinDelivered`.

### 11d - Raids, destruction, and infrastructure decay

Implement:
- village raid resolution;
- partial raid targeting by spawned raid waves;
- village destruction;
- road and field decay scheduling/processing.

Success criteria:
- adjacent evil raiders damage villages at end of big turn;
- destroyed village disappears and stops producing/resting/revealing;
- roads and owned fields from a destroyed village decay over about 6 big turns;
- shared roads/fields remain if another village still references them;
- raiders with destroyed village targets redirect or stop cleanly.

Harness:

```sh
node scripts/sim-harness.mjs --games 10 --turns 100 --compare
node scripts/sim-harness.mjs --games 10 --turns 100 --seed 12345 --json
```

Watch collapse rate, village destruction rate, delivered resources, and
pathfinding cost.

### 11e - Village rest, visibility, and protection

Implement:
- village visibility source;
- villages wake nearby hostiles;
- villages as rest/flee destinations;
- ranger/fighter protection goals for pressured villages and active carts;
- stackable village tiles.

Success criteria:
- villages reveal a stable local area;
- heroes can heal/rest at villages;
- wounded heroes choose a nearby safe village over the castle when appropriate;
- heroes do not flee into a village that is actively being raided;
- nearby rangers/fighters sometimes protect villages/carts without abandoning
  urgent rest or combat;
- path calls/turn and avg turn compute stay acceptable.

### 11f - Steward and balance pass

Teach harness Steward to found villages so sims exercise the feature:
- economy/balanced policies found villages earlier;
- defense delays villages until guard/hero coverage exists;
- heroes/rogues expand opportunistically if food is high.

Success criteria:
- policies diverge in village count and cart success rate;
- villages increase food/coin only when carts survive;
- village openings can fail if under-defended, but do not make collapse rate
  meaningless;
- final food does not explode unbounded by turn 100;
- performance remains close to current harness baseline.

---

## 12. Balance risks and tweaks

### Too much food

Villages deliver food, and food is the castle-tier/growth gate. If villages
produce too much, castle upgrades become automatic.

Tweaks:
- raise founding food cost;
- increase cart interval;
- lower food rate and bias villages toward coin;
- make winter reduce village food before cart payload is calculated.

### Too much safety

Village rest points can make exploration safer and reduce meaningful retreat
distance.

Tweaks:
- villages cannot rest heroes while damaged or adjacent to enemies;
- village healing restores only 75% HP until a later inn/healer feature;
- rest at villages restores HP but not potions/shop access.

### Too much danger

Persistent village vision wakes hostiles, and village-targeted raids can become
a collapse multiplier.

Tweaks:
- cap village-targeted raid chance;
- do not target villages until turn N after founding;
- make village raids destroy stored resources before damaging HP;
- allow nearby heroes to block more than one raider if geared/high-level.

### Carts spam pathfinding

Every cart is an actor. Too many carts could add path calls and combat checks.

Tweaks:
- one active cart per village;
- low village cap;
- cart interval 6+ turns;
- cache cart path until blocked/season changes, if needed.

### Infrastructure decay bugs

Roads can overlap generated roads and other village roads. Fields can overlap
future village footprints if the cap is raised later. Naive decay can erase the
wrong terrain.

Tweaks:
- use player-road and player-field reference counts;
- store original terrain per player-built road/field cell;
- never decay cells whose ref count is positive;
- never decay original `ROAD`, `BRIDGE`, settlement tile, or `CASTLE`.

### UI overload

Tile details, bounty details, village details, actor details, and city view all
compete for the same mobile panel.

Tweaks:
- one action per view for now;
- show only cost, route, yield, and one invalid reason;
- no village sub-buildings in this phase;
- keep bottom bar as a short summary only.

---

## 13. Decisions (resolved — see section 0)

1. Tile marker: **reuse `TOWN`** as the founded village tile (rename its display
   name to "village"); remove cosmetic non-player town/farm generation.
2. Construction: **immediate** after payment.
3. Route rule: require a **known path** from castle/village anchor on
   **summer-cost** road-passable terrain (decision 3).
4. Fields: founding stamps owned `FARM` cells nearby; decay with the shared
   ref-counted helper.
5. Yield model: local terrain scan, **coin-biased**, food → 0 in winter
   (decision 4).
6. Cart model: actor-based carts, one active per village, **cart-specific
   recovery** (decision 1).
7. Protection model: **deferred** (decision 1).
8. Village defense: end-big-turn raid damage, not melee vs a village actor.
9. Rest: villages are rest sites only while alive and not under immediate threat;
   heal generalized per decision 2.
10. Road/field decay: deterministic due-turn jitter; **anchor-chain
    persistence** per decision 6.

---

## 14. Why this fits now

The current game already has the important supporting systems: autonomous actors,
hostile pursuit and raids, bounties, hero rest/flee behavior, panel details
views, visibility, road-aware pathfinding, and harness policy comparison.

Villages should use those systems rather than adding a new management layer. The
feature becomes a geography and protection problem: pick a good known site, pay
for the settlement and road, then keep its carts and buildings alive long enough
for the investment to return.
