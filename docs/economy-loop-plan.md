# Implementation Plan — The Hero Gold Loop (Phase 9)

The last crucial economic mechanic: **heroes earn gold in the wild → spend it at
the kingdom's shops → that spending returns to the treasury as tax.** This is the
authentic Majesty loop, and it replaces the current *interim* hero **wages**
(a flat treasury drain that we always meant to retire once loot + shops existed).

> Status: PLAN ONLY. To be implemented after this is reviewed, *before* the
> next balance pass (the loop reshapes the economy, so balance must follow it).

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
  - Optional small variance via the seeded combat RNG so it isn't perfectly flat (keep deterministic — use `rng` already in scope of combat, or a stat-jitter-style hash).
  - **Guards** (state troops, not heroes) keep paying a *small* amount to the **treasury** directly (they're salaried, not looters) — preserves a trickle from garrison kills and keeps guard-only defense economically alive.
- **Lair bounty** → split among the assaulting heroes' **purses** in `destroyLair` (currently to treasury). This is the big payday that funds an equipment tier.
- **Ruins (hook, optional in 9d):** finally use the inert `exploredRuins`/`discoveredRuins` — a hero ending its turn on an unexplored ruin "delves" it once for a one-time treasure to its purse. Gives rangers a non-combat income and a reason to seek ruins.

### 3.2 Spend — shops at the keep

Heroes spend their purse at the keep (where the buildings are). Two shops:

**Blacksmith → permanent equipment (the main gold sink, the power axis).**
- New per-hero field **`equip`** (integer tier, 0..`EQUIP_MAX` e.g. 5).
- A built **blacksmith** is required to buy. Cost of the next tier: `EQUIP_COST(tier)` rising (e.g. `60 * (tier+1)` → 60/120/180/240/300).
- On purchase: `actor.purse -= cost`; `treasury += round(cost * SHOP_TAX_RATE)`; `actor.equip++`; re-derive combat.
- **Equipment bonuses** stack *additively on top of* the stat/level-derived stats. Extend `applyHeroDerived` to add an equip layer, e.g. per tier: `+1 to-hit` (every tier), `+1 damage mod` (every 2 tiers), `+1 AC` (every 2 tiers), `+3 maxHp` (every tier). So a hero grows on **two axes**: stats from leveling (XP) and gear from gold — exactly Majesty.

**Market → consumables / healing (secondary sink + tax conduit).**
- A built **market** lets heroes buy a **healing potion** (carried, one charge): `actor.potions++` for a price; used automatically when wounded in the field and away from the keep (restores a chunk of HP, lets them stay out longer = more loot).
- Alternatively/additionally, paid healing at the keep (faster/fuller than the free rest). Keep scope tight: start with **potions** only; paid healing is a later nicety.
- Market also raises the kingdom's **tax cut** on *all* shop spending (see 3.3) — its dynamic role replacing the flat `taxBonus`.

**Ordering of spend (when a hero shops):** heal first if hurt and a potion is affordable/needed → then buy the next equipment tier if affordable → else bank the gold. Keep it greedy and simple.

### 3.3 Return — shop tax to the treasury

- **`SHOP_TAX_RATE`** (e.g. base `0.35`, `+0.20` if a **market** is built → 0.55). Every hero purchase adds `round(spend * rate)` to `game.coin`.
- This **replaces the market's flat `taxBonus`** with income that scales with how much heroes actually spend — i.e. with how many heroes are out looting and how rich the wilderness is. Foreshadowed in the GDD.
- `taxIncome()` keeps the **population tax** as the early-game base (before heroes are established) but **drops the rogue `taxDrag`** term (see 3.4). Shop tax is added at purchase time, not inside `taxIncome()`.

### 3.4 Retire wages (the headline change)

- **Remove `heroWages()` from `economyTick`** and the desertion-on-unpayable logic. Heroes are self-funding; the treasury no longer drains per hero.
- `HERO_TEMPLATES[*].wage` becomes vestigial (leave the field or delete; update the city-view hire screen which currently shows nothing for wages but does show rogue `-taxDrag`).
- **Rogues:** their identity was "cheap but drag taxes." Re-skin rather than delete: either (a) rogues simply keep a *larger* share of loot / pay *less* shop tax (greedy — they hoard, the kingdom sees less of their gold), or (b) drop `taxDrag` entirely and let "cheap + weak" be their whole identity. Decision below. Either way remove the `taxDrag` subtraction from `taxIncome()` if we go (b).
- The Steward's hire gates (`coin >= hireCoin + 100`) stay reasonable; without wages the only ongoing cost is upfront hires + buildings, so re-tune the cushion and possibly let policies hire a bit more freely.

---

## 4. Autonomous shopping behavior

Heroes act on innate priorities (Majesty), so shopping must be a *goal*, not a player action:

- Add a **`shop` goal** to `generateGoalCandidates` for heroes: when the hero's
  `purse` can afford something useful (next equip tier, or a potion while hurt)
  **and** the relevant shop is built **and** the hero isn't mid-assault/combat,
  emit a high-ish-utility goal targeting the **castle**. It competes with
  explore/hunt/assault; tune so heroes periodically "cash in" rather than hoard
  forever, but don't abandon an active lair assault to go shopping.
- On **arrival at the castle** (extend `resolveGoalArrival` for `rest`/`shop`/`flee`,
  which already heal there), run `heroShop(actor, events)`: heal→equip→potions in
  the order above, paying tax each purchase. This means shopping also piggybacks
  on the existing rest visits, so even without a dedicated trip heroes spend when
  they pass through to heal.
- Gate so a hero keeps *enough* in reserve (or not — Majesty heroes spend
  freely; simplest is "buy whatever you can afford, cheapest-useful first").

---

## 5. Data-model changes (summary)

- `HERO_TEMPLATES`: (optional) `equipMax`; keep stats; `wage` vestigial.
- Hero actor (in `hireHero`): `purse: 0`, `equip: 0`, `potions: 0`.
- `applyHeroDerived(actor)`: add the equipment-bonus layer (reads `actor.equip`).
- New constants: `LOOT_PER_KILL`, `EQUIP_COST(tier)`, `EQUIP_MAX`, `EQUIP_BONUS` shape, `SHOP_TAX_RATE` (+market delta), `POTION_COST`, `POTION_HEAL`, `LAIR_LOOT` (replaces treasury `LAIR_COIN`).
- `game`: `shopIncome` running total (metric); maybe `wildGold` minted (metric).
- Snapshot: per-hero `purse`/`equip`; aggregate `heroGold` (sum purses), `shopIncome`.
- Hero detail screen: show purse, equip tier, potions, and the equip-derived bonuses.
- City view: blacksmith/market lines reflect their new active roles; maybe show "shop tax this turn."

---

## 6. Phased rollout (commit per sub-phase)

- **9a — Purse & loot.** Add `purse`; route kill-loot and lair-bounty into hero
  purses (guards still trickle to treasury). No spending yet — verify gold
  accrues to heroes and the treasury stops getting kill/lair coin. Harness:
  track `heroGold`. (Temporarily the treasury loses that income — expect a dip;
  9c restores it via shop tax.)
- **9b — Blacksmith equipment + shop tax.** Equipment tiers, `applyHeroDerived`
  equip layer, `heroShop` buying gear at the keep, tax cut to treasury, `shop`
  goal. Verify heroes get stronger and the treasury earns from spending.
- **9c — Retire wages + market re-role.** Remove wages/desertion; market raises
  `SHOP_TAX_RATE` (drop flat `taxBonus`); resolve rogue identity; re-tune the
  Steward. Verify the loop closes and the economy is self-sustaining.
- **9d — (optional) Market potions + ruin treasure.** Field-healing potions;
  ruins finally pay out to delvers. Verify heroes survive longer / rangers earn.
- **Then: the balance pass** over the whole new loop.

Each sub-phase: parse-check → sim-harness compare → render/console smoke → commit.

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
- **Determinism.** Loot variance (if any) must use seeded RNG, never `Math.random`.

---

## 8. Open decisions (resolve before/while building)

1. **Rogue identity** post-wages: (a) greedy hoarder — keeps more loot, kingdom
   taxes them less; or (b) just "cheap & weak," drop `taxDrag` entirely.
   *(Recommend (b) for simplicity now; (a) later if rogues feel flavorless.)*
2. **Market role**: raise `SHOP_TAX_RATE` (recommended — dynamic, scales with
   activity) vs. keep a flat bonus too. *(Recommend: replace flat with rate
   bonus; the whole point is dynamic income.)*
3. **Healing**: free basic rest at keep stays; market adds **carried potions**
   (recommended) and/or paid faster healing (defer).
4. **Ruin treasure** (9d): in scope now or later? *(Recommend later — keeps 9
   focused on the core loop; ruins are a nice bonus income, not the loop.)*
5. **Player direction (bounties)** — the treasury→hero *steering* layer — stays
   **deferred**. The earn→spend→return loop works without it; bounties are the
   natural next phase once this loop is in, and lairs are their first use.

---

## 9. Harness / instrumentation

Add to the sim-harness summary and compare:
- `heroGold` (avg sum of hero purses at end) and **`shopIncome`/game** (treasury
  income from hero spending) — the loop's throughput.
- `avgEquipTier` (how geared the surviving heroes are) — the power axis.
- Re-baseline collapse/pop/coin per policy after **9c** (wages gone changes
  everything) to confirm strategies still diverge before the balance pass.

---

## 10. Why this is the right last piece

With food→population→tax (the kingdom's base), heroes (the embodied agents),
lairs (escalating PvE objectives), and now **gold cycling through heroes**, the
core Majesty economy is complete: the player grows a system, lures and equips
champions who turn the dangerous frontier into the kingdom's revenue, and reaps
the tax. Everything after (bounties, loot/inventory depth, blacksmith variety,
temples/resurrection, villages) is enrichment on top of a closed loop.
