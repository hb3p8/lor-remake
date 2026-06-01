# Implementation Plan — The Hero Gold Loop (Phase 9)

The last crucial economic mechanic: **heroes earn gold in the wild → spend it at
the kingdom's shops → that spending returns to the treasury as tax.** This is the
authentic Majesty loop, and it replaces the current *interim* hero **wages**
(a flat treasury drain that we always meant to retire once loot + shops existed).

> Status: **9a, 9b-i, 9b-ii, 9d DONE** (purse/loot, blacksmith gear + shop tax,
> wages retired, market potions, ruin-delving treasure). The closed loop runs and
> is harness-verified; ruin gold also pulled the once-elevated `heroes` policy
> back to ~25%. All five policies now sit in a healthy 17–33% collapse band.
> Pending: **9e** — the dedicated balance pass (tune loot/equip/shop rates and
> confirm strategy divergence).

---

## 1. The loop in one picture

```
        hire cost (one-time)         loot (kills, lairs, ruins)
 TREASURY ───────────────► HERO ◄───────────────────────────── WILDERNESS
    ▲                       │ purse (personal gold)
    │  shop tax (a cut of    │ spends at the kingdom's shops
    │  every hero purchase)  ▼
    └──────────────── BLACKSMITH / MARKET / (temple, inn …)
```

- **Earn:** heroes take loot from kills and lair-clears into a *personal purse*
  (separate from `game.coin`). The wilderness is where new gold enters the world.
- **Spend:** heroes return to town and buy **permanent equipment** (blacksmith)
  and **consumables/healing** (market). Spending makes them stronger → they
  clear more → loot more.
- **Return:** every hero purchase routes a **tax cut to the treasury**. The
  kingdom profits not by paying heroes, but by being the place heroes spend.
  Shops (market) raise the kingdom's cut, so building them is the lever.

Net effect on strategy: the current tension ("army drains the treasury via
wages") flips into ("invest upfront to hire + build shops, then the heroes'
adventuring *feeds* the treasury"). The player monetizes the wilderness through
heroes instead of subsidizing them.

---

## 2. Current state (what we build on / replace)

Real functions/constants this touches (in `index.html` unless noted):

- `rewardForKill(actor, hostile, events)` — currently `game.coin += max(2, round(threat*3))` straight to the treasury, for *any* killer.
- `destroyLair(lair, events)` — `game.coin += LAIR_COIN` (120) to the treasury; XP split among nearby heroes.
- `economyTick(events)` — adds `round(taxIncome())`, then subtracts `heroWages()` (deserting the worst-paid hero if unpayable).
- `taxIncome()` — `population*TAX_PER_CAPITA(1.6) + market.taxBonus(8) − rogues*rogue.taxDrag(4)`.
- `heroWages()` — sum of `HERO_TEMPLATES[role].wage` (ranger 2 / fighter 4 / monster 5 / rogue 0). **← the interim scaffold to remove.**
- `hireHero(guild)` — `game.coin -= hireCoin`; builds the actor; calls `applyHeroDerived`.
- `applyHeroDerived(actor)` — derives `atk / ac / dmg / maxHp` from stats + level. **← equipment bonuses bolt on here.**
- `BUILDINGS.market { coin:150, build:3, taxBonus:8 }` (flat bonus today), `BUILDINGS.blacksmith { coin:110, build:3 }` (**inert** — GDD says "until the equipment system exists"; this is that system).
- `runSteward()` — hires toward policy targets when `coin >= hireCoin + 100`; gates assume wages exist.
- `generateGoalCandidates()` / `chooseGoal()` / `goalIsValid()` — shopping has to fit the existing goal system, which ignores targets already occupied by the actor.
- `resolveGoalArrival()` — rest/flee arrivals already heal at the castle; shopping should hook here and also handle heroes already standing at the keep.
- `lairAssaultReady(actor)` — currently level-gated (`monster` 3, others 4); equipment must count toward readiness or gear will not help heroes choose lair clears.
- `POLICIES` — several build orders assume the market is flat income; after the market becomes a shop-tax multiplier, policies that build markets need a real shop sink.
- `actorSnapshot` / sim-harness metrics — need purse/equip/shop-income fields.

GDD already foreshadows this: §5/§6 note the market's income "later scales with
hero loot-selling," the blacksmith is "inert until equipment," and §15 lists
wages as an interim that loot/market/bounties will replace.

---

## 3. Design

### 3.1 Earn — the hero purse

- New per-hero field **`purse`** (gold), 0 at hire. Set in `hireHero`; include in `actorSnapshot`.
- **Loot from kills** → the *killer's* purse (if a hero), via `rewardForKill`:
  - `LOOT_PER_KILL[kind]` table (parallels `XP_PER_KILL`), e.g. boar 3 / wolf 4 / goblin 5 / bandit 7 / bear 12 / skeleton 5 / troll 30. Monsters/big game pay more.
  - Start with fixed values. Add variance later only if the flat numbers feel sterile; deterministic balance is more useful during the first pass.
  - **Guards** (state troops, not heroes) keep paying a *small* amount to the **treasury** directly (they're salaried, not looters) — preserves a trickle from garrison kills and keeps guard-only defense economically alive.
- **Lair bounty** → split among the assaulting heroes' **purses** in `destroyLair` (currently to treasury). This is the big payday that funds an equipment tier.
- **Ruins (9d):** finally use the inert `exploredRuins`/`discoveredRuins`. Add a `delve` goal for discovered unexplored ruins and pay one-time treasure to the delver's purse on arrival. Do not rely on incidental "ended on a ruin" behavior; current exploration goals do not intentionally target ruins.

### 3.2 Spend — shops at the keep

Heroes spend their purse at the keep (where the buildings are). Two shops:

**Blacksmith → permanent equipment (the main gold sink, the power axis).**
- New per-hero field **`equip`** (integer tier, 0..`EQUIP_MAX` e.g. 5).
- A built **blacksmith** is required to buy. Cost of the next tier: `EQUIP_COST(tier)` rising (e.g. `60 * (tier+1)` → 60/120/180/240/300).
- On purchase: `actor.purse -= cost`; `treasury += round(cost * shopTaxRateFor(actor))`; `actor.equip++`; re-derive combat.
- **Equipment bonuses** stack *additively on top of* the stat/level-derived stats. Extend `applyHeroDerived` to add an equip layer, e.g. per tier: `+1 to-hit` (every tier), `+1 damage mod` (every 2 tiers), `+1 AC` (every 2 tiers), `+3 maxHp` (every tier). So a hero grows on **two axes**: stats from leveling (XP) and gear from gold — exactly Majesty.
- HP rule: if equipment raises `maxHp`, also add the gained max-HP delta to current `hp`, capped at the new max. Buying armor at the keep should not leave the hero immediately "wounded" by the new maximum.
- Lair readiness should use combat power as well as level. Replace the hard-only level gate with something like: healthy enough, and (`level >= old threshold` **or** `unitPower(actor)` reaches a tuned threshold). This lets a geared level-2/3 hero reasonably assault while preserving danger for weak heroes.

**Market → consumables / healing (secondary sink + tax conduit).**
- A built **market** lets heroes buy a **healing potion** (carried, one charge): `actor.potions++` for a price; used automatically when wounded in the field and away from the keep (restores a chunk of HP, lets them stay out longer = more loot).
- Alternatively/additionally, paid healing at the keep (faster/fuller than the free rest). Keep scope tight: start with **potions** only; paid healing is a later nicety.
- Market also raises the kingdom's **tax cut** on *all* shop spending (see 3.3) — its dynamic role replacing the flat `taxBonus`.
- Potions are part of the market re-role, not an optional nice-to-have for the first complete loop. Without potions, market-only policies can build a market that has little or no value if they never build a blacksmith.

**Ordering of spend (when a hero shops):** heal first if hurt and a potion is affordable/needed → then buy the next equipment tier if affordable → else bank the gold. Keep it greedy and simple.

### 3.3 Return — shop tax to the treasury

- **`SHOP_TAX_RATE`** (e.g. base `0.35`, `+0.20` if a **market** is built → 0.55). Every hero purchase adds `round(spend * rate)` to `game.coin`.
- This **replaces the market's flat `taxBonus`** with income that scales with how much heroes actually spend — i.e. with how many heroes are out looting and how rich the wilderness is. Foreshadowed in the GDD.
- `taxIncome()` keeps the **population tax** as the early-game base (before heroes are established) but **drops the rogue `taxDrag`** term (see 3.4). Shop tax is added at purchase time, not inside `taxIncome()`.
- Track `game.shopIncome` (lifetime) and `game.lastShopIncome` (reset each big turn, display/debug metric).

### 3.4 Retire wages (the headline change)

- **Remove `heroWages()` from `economyTick`** and the desertion-on-unpayable logic. Heroes are self-funding; the treasury no longer drains per hero.
- Delete `heroWages()` or leave only a debug shim returning 0 until all callers are gone. Remove `wage` from visible design language.
- **Rogues:** keep their economic identity by making them greedy shoppers. Remove per-turn `taxDrag`, but make `shopTaxRateFor(rogue)` return a reduced cut, e.g. `normalRate * 0.7`. They remain cheap bodies, but the kingdom captures less of their loot cycle.
- The Steward's hire gates (`coin >= hireCoin + 100`) should be re-tuned in the same phase that wages are removed. Without wages, the cushion is only protecting building/upgrade timing, not payroll.

---

## 4. Autonomous shopping behavior

Heroes act on innate priorities (Majesty), so shopping must be a *goal*, not a player action:

- Add a **`shop` goal** to `generateGoalCandidates` for heroes: when the hero's
  `purse` can afford something useful (next equip tier, or a potion while hurt)
  **and** the relevant shop is built **and** the hero isn't mid-assault/combat,
  emit a high-ish-utility goal targeting the **castle**. It competes with
  explore/hunt/assault; tune so heroes periodically "cash in" rather than hoard
  forever, but don't abandon an active lair assault to go shopping.
- Use explicit gating before adding the goal:
  - no adjacent hostiles;
  - no current `assault` goal with a valid path/commitment;
  - not already next to an active lair;
  - not already at the castle (handle that immediately instead; see below).
- Initial utility target: `shop` below wounded `rest` (260) and monster-hunter top-priority lair assault (200), but above ordinary explore (~60). Start around 130-160 and tune from harness hoarding/spending metrics.
- On **arrival at the castle** (extend `resolveGoalArrival` for `rest`/`shop`/`flee`,
  which already heal there), run `heroShop(actor, events)`: heal→equip→potions in
  the order above, paying tax each purchase. This means shopping also piggybacks
  on the existing rest visits, so even without a dedicated trip heroes spend when
  they pass through to heal.
- Also run `heroShop(actor, events)` for a hero that begins a sub-turn already on
  the castle tile before goal selection. `chooseGoal()` rejects same-cell targets,
  so "shop at the castle" cannot depend only on a normal pathing goal.
- Gate so a hero keeps *enough* in reserve (or not — Majesty heroes spend
  freely; simplest is "buy whatever you can afford, cheapest-useful first").

Implementation shape:
- `heroCanShop(actor)` returns true if at least one useful purchase is currently affordable and unlocked.
- `heroShop(actor, events)` loops greedily but bounded: heal/rest state is already handled by arrival, then buy one equipment tier if affordable, then buy at most one potion if market is built and the hero has fewer than the carry cap.
- `SHOP_POTION_CAP` should start at 1. More potions can wait until survival balance proves it is needed.

---

## 5. Data-model changes (summary)

- `HERO_TEMPLATES`: optional `equipMax`; keep stats; remove or ignore `wage` and `taxDrag`.
- Hero actor (in `hireHero`): `purse: 0`, `equip: 0`, `potions: 0`.
- `applyHeroDerived(actor)`: add the equipment-bonus layer (reads `actor.equip`).
- New constants/functions: `LOOT_PER_KILL`, `GUARD_KILL_COIN`, `EQUIP_COST(tier)`, `EQUIP_MAX`, `EQUIP_BONUS` shape, `SHOP_TAX_RATE_BASE`, `SHOP_TAX_RATE_MARKET_BONUS`, `ROGUE_SHOP_TAX_MUL`, `POTION_COST`, `POTION_HEAL`, `SHOP_POTION_CAP`, `LAIR_LOOT` (replaces treasury `LAIR_COIN`), `shopTaxRateFor(actor)`.
- `game`: `shopIncome` lifetime metric, `lastShopIncome` per-big-turn display/debug metric, `wildGold` minted metric.
- Snapshot: per-hero `purse`/`equip`/`potions`; aggregate `heroGold` (sum purses), `avgEquipTier`, `shopIncome`, `wildGold`.
- Hero detail screen: show purse, equip tier, potions, and the equip-derived bonuses.
- City view: replace `+tax -pay` with population tax plus shop-tax context; blacksmith/market lines reflect their new active roles.
- Turn report / event text: include compact messages for large purchases and lair payouts, but avoid spamming every potion top-up if it becomes noisy.

---

## 6. Phased rollout (commit per sub-phase)

The important ordering constraint: do **not** remove wilderness treasury income
while wages still drain the treasury and no shop-tax replacement exists. That
creates a known-bad intermediate economy and makes harness results hard to
interpret. First add observability, then switch the closed loop in one behavior
phase, then tune.

Each sub-phase: parse-check → targeted sim-harness run → render/console smoke →
commit.

### 9a — Metrics and inert data

Add fields and instrumentation without changing behavior:
- hero fields: `purse`, `equip`, `potions`;
- game fields: `shopIncome`, `lastShopIncome`, `wildGold`;
- snapshot/harness fields: `heroGold`, `avgEquipTier`, `shopIncome`, `wildGold`;
- actor/city detail placeholders for purse/equipment/potions.

Success criteria:
- `node scripts/sim-harness.mjs --games 10 --turns 100 --seed 1592594996` runs.
- With no behavior changes, policy compare metrics should be effectively
  unchanged from baseline except for new zero-valued fields.
- Snapshots include the new fields with sane zero/default values for all heroes.

### 9b — Core closed loop switch

Implement the complete minimum loop in one behavior step:
- route hero kill loot and lair loot to hero purses;
- keep a small direct treasury reward for guard kills only;
- add blacksmith gear purchase, `heroShop`, shop tax, and shop goal;
- add market potion purchase and automatic field use;
- run `heroShop` on rest/flee/shop arrival and for heroes already at the castle;
- remove wages/desertion and drop market flat `taxBonus`;
- remove rogue per-turn `taxDrag`; add reduced rogue shop-tax capture;
- update `lairAssaultReady` so equipment/combat power can qualify a hero;
- re-tune Steward cushions and build orders so market users have a spend path
  (blacksmith and/or potions).

Success criteria:
- `wildGold` moves upward when heroes score kills; hero kills no longer add
  direct treasury coin.
- Purchases lower `heroGold` and raise `shopIncome`; because `SHOP_TAX_RATE < 1`,
  `wildGold` is expected to be greater than `heroGold + shopIncome` after buys.
- In a fixed-seed JSON run with at least one blacksmith built, at least one hero
  buys gear by turn 100 in policies that field fighters/monster-hunters.
- `shopIncome > 0` in at least one of `balanced`, `heroes`, or `economy` by turn
  100 under `--compare`.
- A market-built policy can generate `shopIncome` through potions even before
  blacksmith gear purchases.
- No desertion events occur because payroll no longer exists.
- `avgEquipTier` is non-zero for at least one combat-heavy policy by turn 100.
- Collapse rate does not exceed the old baseline by more than roughly 15
  percentage points in `node scripts/sim-harness.mjs --games 10 --turns 100
  --compare`. If it does, stop and tune hire/build cushions before adding more
  systems.

### 9c — UI polish and policy sanity

Make the completed loop understandable and clean up stale model language:
- update city/hero/report text to explain the new economy in the small mobile UI;
- remove old wage/tax-drag wording from comments, GDD-facing text, and visible UI;
- adjust Steward policy build orders if 9b metrics show market/blacksmith timing
  is blocking the loop.

Success criteria:
- Potion use appears in events rarely but clearly; it must not spam every
  sub-turn.
- Friendly death and collapse metrics do not fall to zero across policies; the
  system should improve survivability, not erase danger.
- City view text fits on the mobile grid: no clipped long tax/wage remnants.

### 9d — Ruin delving

Add the optional non-combat purse source:
- add a `delve` goal for discovered unexplored ruins, biased toward rangers;
- pay a one-time ruin treasure to the delver's purse;
- mark `exploredRuins` and expose ruin-search metrics in the harness.

Success criteria:
- `ruinsExplored` increases in ranger-heavy games.
- Rangers can earn purse gold without needing combat kills.
- Delving must not dominate exploration: discovered percent by turn 50 should
  remain close to baseline for ranger policies.

### 9e — Balance pass

Tune numbers only after the full loop exists:
- loot table;
- equipment costs/bonuses/max tier;
- shop tax rates and rogue multiplier;
- potion cost/heal/carry cap;
- Steward build/hire cushions.

Success criteria:
- Strategy comparison still diverges: economy/rogues/heroes/defense/balanced
  should not converge to the same final population, building count, hero count,
  and collapse rate.
- `shopIncome` is meaningful but not the only income source; population tax still
  matters before the hero economy matures.
- Treasury does not run away: final coin should not climb unbounded while all
  build/upgrade opportunities are still incomplete.
- Positive feedback is bounded: average equipment tier rises, but most heroes
  should not hit `EQUIP_MAX` by turn 100 under normal policies.

---

## 7. Balance considerations & risks

- **Loss of the wage tension.** Wages are currently *the* economy↔army lever and
  a big driver of strategy divergence. Removing them flattens that unless the new
  loop creates its own tension: the new levers are **upfront hire cost**, **shop
  buildings to capture spending**, and **loot-rich vs. loot-poor maps/lairs**.
  Watch the harness for whether strategies still diverge; if not, add a sink
  (e.g. heroes only spend where shops exist, so no blacksmith = heroes hoard
  dead gold; or a per-hero upkeep that's *paid from the purse*, not the treasury).
- **Positive feedback / snowball.** gear → faster clears → more loot → more gear.
  Bound it: `EQUIP_MAX` cap, rising `EQUIP_COST`, `SHOP_TAX_RATE < 1` (gold leaves
  the loop on every cycle), finite lairs, and the existing coin sinks (castle
  upgrades, buildings). Confirm the treasury doesn't run away.
- **Early game.** Before heroes exist, the treasury still rides population tax —
  unchanged. The loop only kicks in once heroes are hired and shops built, which
  is the intended mid-game pivot.
- **Hero hoarding / never spending.** If the `shop` goal is too weak heroes bank
  gold forever and the treasury never sees tax. Tune the goal so they cash in
  regularly (piggybacking on rest visits helps).
- **Market dead-end.** Once the flat market bonus is gone, a market only matters
  if heroes can buy something. Keep potions in the first complete loop and make
  sure Steward policies that build markets also create a spending path.
- **Gear invisibility.** If equipment only changes combat math, it may not change
  strategic behavior because lair assault currently checks level. Include combat
  power/equip in lair readiness so gear visibly changes hero choices.
- **Already-at-keep shopping.** The goal system rejects same-cell targets. Call
  shopping directly when a hero is at the castle; otherwise a hero can stand on
  the shop tile and never buy.
- **Rogue flattening.** Removing tax drag without a replacement makes rogues lose
  their economic drawback. Reduced rogue shop-tax capture preserves the theme
  with less per-turn bookkeeping.
- **Determinism.** Loot variance (if any) must use seeded RNG, never `Math.random`.

---

## 8. Decisions locked for Phase 9

1. **Rogues:** remove per-turn `taxDrag`; use reduced shop-tax capture instead
   (`ROGUE_SHOP_TAX_MUL`, start around 0.7). This preserves "cheap but greedy"
   without keeping a payroll-era tax penalty.
2. **Market:** replace flat `taxBonus` with a shop-tax-rate bonus. Do not keep
   both except temporarily behind a comment during implementation debugging.
3. **Healing:** free keep rest stays. Market adds carried potions with cap 1.
   Paid keep healing is deferred.
4. **Ruin treasure:** defer to 9d after the core loop and potions work. Add a
   real `delve` goal when it lands.
5. **Bounties:** deferred. The earn→spend→return loop must stand without player
   reward flags; bounties are the next steering layer once this loop is stable.
6. **Loot variance:** no variance in Phase 9. Fixed tables make harness
   comparison easier.
7. **Equipment HP:** buying max-HP gear heals the max-HP delta immediately.

---

## 9. Harness / instrumentation

Add to the sim-harness summary and compare:
- `heroGold` (avg sum of hero purses at end) and **`shopIncome`/game** (treasury
  income from hero spending) — the loop's throughput.
- `avgEquipTier` (how geared the surviving heroes are) — the power axis.
- `wildGold` minted — all gold created from hero kills, lairs, and ruins before
  shop-tax capture.
- `potionBuys` / `potionUses` — to prove the market is active and not just a tax
  multiplier.
- `gearBuys` — to prove the blacksmith is active.
- Re-baseline collapse/pop/coin per policy after **9b** and again after **9c**;
  wages gone changes everything, and potions change survival.

Required commands:

```sh
node scripts/sim-harness.mjs --games 10 --turns 100 --seed 1592594996
node scripts/sim-harness.mjs --games 10 --turns 100 --compare
node scripts/sim-harness.mjs --games 10 --turns 100 --seed 12345 --json
```

Use `--json` to inspect per-seed cases whenever an average hides the reason:
heroes alive but `heroGold` high and `shopIncome` zero means shopping is too weak
or shops are missing; `wildGold` high and `avgEquipTier` zero means the blacksmith
path is blocked; `shopIncome` high with collapsing population means the loop is
profitable but defense timing broke.

---

## 10. Why this is the right last piece

With food→population→tax (the kingdom's base), heroes (the embodied agents),
lairs (escalating PvE objectives), and now **gold cycling through heroes**, the
core Majesty economy is complete: the player grows a system, lures and equips
champions who turn the dangerous frontier into the kingdom's revenue, and reaps
the tax. Everything after (bounties, loot/inventory depth, blacksmith variety,
temples/resurrection, villages) is enrichment on top of a closed loop.
