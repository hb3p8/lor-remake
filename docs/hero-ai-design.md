# Hero AI: Event-Driven Commitment & Unified Utility

A design note for two planned upgrades to how heroes (and other actors) pick
goals in `index.html`, plus where the approach sits in the wider landscape of
autonomous-actor AI (FSMs, behaviour trees, utility AI, GOAP/HTN, search).

> Status: **design only.** Neither change is implemented yet. The groundwork
> (`GOAL_UTIL`, a single candidate list, a commitment timer) already exists.

---

## 1. Where we are today

Each sub-turn, `chooseGoal(actor)` decides what an actor does:

```js
function chooseGoal(actor) {
  if (goalIsValid(actor)) return actor.goal;          // (A) commitment
  const candidates = generateGoalCandidates(actor);    // (B) generation
  for (const c of candidates) {                        // (C) pick first reachable
    const path = findPath(actor, c.target);
    if (!path || path.length < 2) continue;
    actor.goal = { type: c.type, target: c.target, path: path.slice(1),
                   utility: Math.round(c.utility), reason: c.reason,
                   committedUntilTurn: game.turn + 2 };
    return actor.goal;
  }
  actor.goal = null;
  return null;
}
```

Three moving parts:

- **(A) Commitment** — `goalIsValid` keeps the current goal for `committedUntilTurn = turn + 2`
  unless the actor *arrived*, *lost its path*, or *became wounded*
  (`needsRest && goal.type !== 'rest'`). This is anti-thrash: without it a hero
  re-paths every sub-turn and dithers.
- **(B) Generation** — `generateGoalCandidates` is a **hard priority cascade**:
  a ladder of `if (tryX()) return finish()`. The first applicable tier
  short-circuits and returns, so a marginally-higher tier *always* beats a much
  better lower one. Utilities (`GOAL_UTIL`) only sort candidates *within* the
  one tier that returned (and feed step C's reachability fallback).
- **(C) Selection** — walk the (utility-sorted) candidates, take the first one
  `findPath` can actually reach.

The two known limitations, and the two upgrades that address them:

| Limitation | Upgrade |
|---|---|
| Commitment is a blind 2-turn timer — a hero ignores a crypt waking next to it, a fat new bounty, or a raid alarm until the timer lapses. | **Event-driven commitment** (§2) |
| The cascade can't trade off across tiers — "chase a distant boar" always beats "buy the gear I desperately need" because hunt sits above shop. | **Unified utility** (§3) |

---

## 2. Event-driven commitment

### 2.1 Goal

Keep the anti-thrash benefit of commitment, but **let high-salience events
interrupt it**, so heroes feel responsive without re-deciding every tick.

Today the only interrupts are: arrival, lost path, and `needsRest`. We want to
add a small, explicit set of "something changed enough to reconsider" triggers.

### 2.2 Design

Replace the blunt "valid until turn N" with "valid until turn N **unless a
salient event invalidates it**." Two complementary mechanisms:

1. **Event flags / a dirty bit.** When something noteworthy happens to or near
   an actor, mark it for re-evaluation next time `chooseGoal` runs.
2. **Salience predicates in `goalIsValid`.** Cheap per-call checks that drop the
   commitment when the world has changed in a way the current goal doesn't
   account for.

Mechanism (2) is simpler and stateless; (1) is more precise but needs the event
sites to set the flag. A pragmatic build uses (2) for things derivable from
current state and (1) for discrete events.

### 2.3 Implementation sketch

```js
// Salience checks: does the actor's situation differ enough from when it
// committed that it should reconsider now, before the timer lapses?
function commitmentBroken(actor) {
  const g = actor.goal;
  if (!g) return true;

  // (a) A live threat just came adjacent and we're not already fighting/fleeing
  //     toward it — re-decide (fight, flee, or stealth).
  if (!actor.recheckThreat && adjacentLivingHostiles(actor).length) {
    if (g.type !== 'engage' && g.type !== 'flee' && g.type !== 'assault') return true;
  }

  // (b) The realm sounded a raid alarm since we committed (raiders near home,
  //     or the raid timer about to fire) — defenders should reconsider.
  if (actor.hero && game.raidAlarmTurn > g.committedAtTurn) return true;

  // (c) A bounty richer than our current draw was posted/raised since we
  //     committed (only matters for goals we'd swap *to* a bounty for).
  if (actor.hero && game.bountyDirtyTurn > g.committedAtTurn
      && g.utility < bestReachableBountyUtility(actor)) return true;

  return false;
}

function goalIsValid(actor) {
  const g = actor.goal;
  if (!g || !g.target) return false;
  if (actor.tamed) return false;                       // pets re-read every turn
  if (needsRest(actor) && g.type !== 'rest') return false;
  if (actor.x === g.target.x && actor.y === g.target.y) return false;
  if (!g.path || !g.path.length) return false;
  if (commitmentBroken(actor)) return false;           // NEW
  return game.turn < g.committedUntilTurn;              // timer is now the *ceiling*
}
```

Supporting state:

- Stamp goals with `committedAtTurn` as well as `committedUntilTurn`.
- Maintain a couple of cheap global "dirty turn" stamps set at the event sites:
  - `game.raidAlarmTurn = game.turn` in `spawnRaidWave` / `maybeVikingRaid`, or
    when an evil hostile first comes within N of the keep/a village.
  - `game.bountyDirtyTurn = game.turn` in `raiseBounty` / `cancelBounty`.
- Optional per-actor `recheckThreat` flag set when a hostile steps adjacent to
  it during movement resolution.

`bestReachableBountyUtility(actor)` reuses the same scoring as the
`tryBounty*` helpers — factor it out so the predicate and the generator agree.

### 2.4 Avoiding the thrash you just removed

The whole point of commitment is to stop oscillation, so interrupts must be
**rare and meaningful**:

- Gate each trigger so it fires on a *transition*, not a *state*
  (`game.X_dirtyTurn > g.committedAtTurn`, not "is there a bounty").
- Keep a **minimum commitment floor** (e.g. ignore non-emergency interrupts for
  the first turn after committing) so a hero can't be tugged between two flags
  every sub-turn.
- Treat **emergencies** (adjacent threat) as always-interrupt, **opportunities**
  (a richer bounty) as interrupt-only-if-clearly-better (`g.utility < new − ε`).

### 2.5 Testing

- Determinism: all triggers are state/stamp-derived, no RNG — the harness stays
  reproducible.
- Add a probe: count goal switches/hero/turn before vs after; it should rise
  only modestly (responsiveness) without exploding (thrash).
- Watch collapse rate: the raid-alarm interrupt is the one most likely to move
  it (heroes peel back to defend).

---

## 3. Unified utility instead of the hard cascade

### 3.1 Goal

Let **every** candidate goal be scored on one comparable scale and pick the best
reachable one, so behaviour emerges from competing pressures (urgency, reward,
winnability, distance, crowding) instead of a fixed tier order.

### 3.2 The core change

Today each role branch does `if (tryX()) return finish()`. Unified utility
removes the short-circuits: **always generate the full candidate set, each with
a calibrated absolute utility, then let step (C) pick the best reachable.**

```js
function generateGoalCandidates(actor) {
  const C = [];
  // Non-negotiables stay as early returns (cart, tamed pet, fleeing).
  if (actor.cart)  { C.push(deliverGoal(actor)); return done(C); }
  if (actor.tamed) { C.push(petGoal(actor));     return done(C); }

  // Everyone else: contribute every plausible candidate, scored absolutely.
  pushRestCandidate(C, actor);        // util rises as HP falls
  pushBountyCandidates(C, actor);     // base + reward·k − dist·k  (one per flag)
  pushHuntCandidates(C, actor);       // base + threat − dist + winnability
  pushLairCandidates(C, actor);       // gated by lairAssaultReady, scaled by reward
  pushDefendKeepCandidate(C, actor);  // util scales with raid proximity
  pushShopCandidate(C, actor);        // util rises with unspent purse + need
  pushExtortCandidate(C, actor);      // rogues
  pushTameCandidate(C, actor);        // rangers
  pushExploreCandidates(C, actor);    // frontier
  pushIdleCandidates(C, actor);       // carouse / wander floor
  return done(C);
}
```

`chooseGoal` is unchanged — it already takes the highest-utility reachable
candidate. The work is entirely in **making the utilities comparable**.

### 3.3 Making scores comparable (the hard part)

A cascade hides a calibration problem; a utility system exposes it. Techniques:

- **Normalize inputs to 0..1 before weighting.** Distance, HP fraction, reward
  fraction (`reward / BOUNTY_MAX`), odds (`unitPower(self)/unitPower(foe)`),
  raid proximity — each mapped into 0..1, then combined. This is the heart of
  Dave Mark's *Infinite Axis Utility System* (IAUS): each consideration is a
  curve `f(input)→[0,1]`, an action's score is the product (or weighted sum) of
  its considerations.
- **Response curves, not linear terms.** "HP" shouldn't be linear: rest should
  be near-zero utility at 90% HP and dominate near death. Use shaped curves
  (e.g. quadratic, logistic) per consideration. A small `curve(x, type)` helper
  covers linear/quadratic/inverse/logistic.
- **Multiplicative gating.** Multiply by a 0/1 (or 0..1) feasibility factor so
  an infeasible action zeroes out (e.g. `canShop ? 1 : 0`, `lairReady ? 1 : 0`)
  instead of needing a hard `if`. Multiplication also gives natural AND-ing:
  "high reward AND close AND winnable" beats "high reward but far and deadly."
- **Keep a few hard rails as early returns.** Cart/pet/flee/needsRest are
  identity or safety constraints, not preferences — leave them as short-circuits
  above the scored pool. Utility is for *choices*, not *constraints*.

Illustrative scoring of one candidate:

```js
function huntScore(actor, h) {
  const close   = curve(1 - dist(actor, h) / 40, 'linear');         // nearer = better
  const winnable= curve(unitPower(actor) / unitPower(h), 'logistic');// can I win?
  const value   = curve((isEvil(h) ? 1 : 0.4) + (h.raider ? 0.5 : 0), 'clamp');
  const feasible = game.visible[idx(h.x, h.y)] ? 1 : 0;
  return BASE.hunt * close * winnable * value * feasible;            // 0..BASE.hunt
}
```

`GOAL_UTIL` becomes the per-action **base weight** (the ceiling each action can
reach); the considerations scale it down toward 0. That keeps the "table you can
read at a glance" property we already built.

### 3.4 Inertia (or it dithers)

Removing the cascade removes its implicit stability — two actions with nearly
equal scores will flip-flop sub-turn to sub-turn. Add **hysteresis**:

- Give the *currently committed* goal a small utility bonus (commitment inertia)
  so it only loses when something is *clearly* better, not marginally.
- This is exactly why §2 (event-driven commitment) is the natural partner: the
  commitment system becomes the damper that makes unified utility stable.
  Implement §2 first, then §3 on top.

### 3.5 Migration path (incremental, low-risk)

You don't have to flip the whole thing at once:

1. **Per-tier internal scoring already done** (reward-weighted bounties,
   winnability) — utilities inside a tier are already real.
2. **Collapse adjacent tiers** that genuinely compete (e.g. hunt vs lair vs
   shop for a fighter): generate all three, drop the `return finish()` between
   them, let utility choose.
3. **Calibrate** with the harness (collapse rate, kills, coin, exploration) at
   each step; revert a tier-merge if it dithers or misbehaves.
4. **Fully unified** only once the merged groups behave. Some constraints
   (cart/pet/flee) stay hard forever.

### 3.6 Cost & pitfalls

- **Perf:** scoring every candidate every re-decision is more work than
  short-circuiting, but the actor count is tiny (≤ ~12 heroes + guards) and
  `findPath` already dominates; negligible.
- **Tuning tail:** the main cost. Utility systems trade hand-authored priority
  for hand-authored curves/weights — powerful but fiddly. Budget harness time.
- **Emergent surprises:** the upside (unscripted, situational behaviour) is also
  the risk (a weighting bug makes heroes do something daft). Keep the `reason`
  string on each goal and a "why did it pick this" debug dump.

---

## 4. Where this sits among established approaches

A rough ladder of autonomous-actor decision techniques, cheapest/most-rigid to
most-flexible/most-expensive, and where lor-remake's hero AI falls.

### 4.1 Finite State Machines (FSM)
Explicit states + transitions ("Patrol → Chase → Attack → Flee"). Simple,
debuggable, but transition spaghetti grows quadratically and one actor is in
exactly one state. **lor-remake is *not* an FSM** — actors have no persistent
state machine; they re-derive intent each tick. (The closest thing to a state is
the committed goal, but it's a cached decision, not a state with transition
rules.)

### 4.2 Decision lists / prioritized rules ← **we are here**
An ordered list of `if condition then action`, first match wins. Trivial to read
and tune, but can't express trade-offs (priority is positional). **This is
exactly our cascade**: `generateGoalCandidates`'s ladder of
`if (tryX()) return finish()` is a first-match decision list, per role. It's the
workhorse of countless shipped games precisely because it's predictable.

### 4.3 Behaviour Trees (BT)
The current AAA default. A tree of composite nodes — **Selector** (try children
until one succeeds; this *is* a priority cascade), **Sequence** (do children in
order), **Decorators** (conditions, inverters, cooldowns), and leaf actions.
- Our cascade is essentially **one big Selector with leaf "try" actions** — i.e.
  a flattened, hand-coded behaviour tree without the node objects.
- **Event-driven commitment (§2)** maps directly onto BT practice: modern BTs
  use **reactive/event-driven evaluation** and **interrupt decorators** (abort
  a running subtree when a higher-priority condition becomes true). Our
  `commitmentBroken` predicates are precisely "abort-if-higher-priority" /
  "abort-on-event" decorators. So §2 moves us toward a *reactive* BT.
- BTs still encode priority *structurally* (left-to-right), so they share the
  cascade's "can't trade off across branches" weakness — which is why utility is
  often bolted on (see §4.4).

### 4.4 Utility AI / Utility-based AI ← **§3 takes us here**
Score every option on a common scale, pick the max (or sample proportionally).
The canonical formulation is Dave Mark's **Infinite Axis Utility System
(IAUS)**: each action has *considerations*, each a normalized input run through
a *response curve*, combined (usually multiplied) into a score. Used in *The
Sims* (need-based), *Guild Wars 2*, *Shadow of Mordor*, and many others.
- **§3 is a direct move from a decision list (4.2) to Utility AI.** We already
  started: reward-weighted bounties and winnability are considerations; `GOAL_UTIL`
  is the base-weight table.
- Hybrid is common and probably right for us: **utility for choices, BT/rules
  for constraints** ("utility-selector" nodes inside a behaviour tree). Our
  hard early-returns (cart/pet/flee) + scored pool is exactly that hybrid.
- Trade-off vs BT: utility gives smoother, more situational, less scripted
  behaviour, at the cost of opaque tuning and possible dithering (hence §2's
  inertia).

### 4.5 Planning: GOAP and HTN
- **GOAP** (Goal-Oriented Action Planning; *F.E.A.R.*, 2005): actions have
  pre/post-conditions; an A\* search over world-states finds a sequence to reach
  a goal state. Powerful for *multi-step plans* ("to kill X I must first get a
  weapon, which means going to the armory").
- **HTN** (Hierarchical Task Networks; *Killzone*, *Transformers*): decompose a
  high-level task into subtasks via methods, down to primitives.
- **lor-remake doesn't plan multi-step** — it picks a single next goal each tick
  and re-derives. Our "goals" are one-step intents, not plans. We *could* graduate
  to GOAP-ish chaining (e.g. "shop → then assault lair"), but the per-tick
  re-decision + cheap world already produces emergent sequences without an
  explicit planner. Planning is the right tool when actions have strong
  ordering dependencies; ours mostly don't.

### 4.6 Adversarial / decision-tree search (minimax, MCTS)
Search the *tree of future game states* and pick the move maximizing an
evaluation (minimax + alpha-beta for turn-based zero-sum; **MCTS** for high
branching / no good heuristic — Go, many board games; also used for tactics in
*Total War*-likes and for whole-AI in some 4X games).
- This is a different axis: §§4.1–4.5 decide an action from the *current* state;
  search decides by *simulating forward*.
- **lor-remake is reactive, not search-based** — and deliberately so: it's
  real-time-ish with many actors and a cheap "what should I do now" question, not
  a two-player lookahead. The closest the codebase comes to forward simulation is
  the **headless harness** (`stepSimulationTurn`), which we use *offline to tune*
  the reactive policy — not online to choose moves. (One could imagine a Steward
  that does shallow lookahead over build/bounty decisions; that would be genuine
  search, and overkill for now.)

### 4.7 Learned policies (RL, neural nets)
Train a policy from reward via self-play (DRL). Maximally flexible, opaque,
data-hungry, hard to make deterministic, and a poor fit for a small,
hand-balanced single-file game. **Not a path we'd take** — but worth noting the
harness is, in principle, the simulator such a method would need.

### 4.8 Summary table

| Approach | Trades off across options? | Multi-step plans? | Forward search? | Tuning | lor-remake |
|---|---|---|---|---|---|
| FSM | no (one state) | no | no | easy | no |
| Decision list / prioritized rules | no (positional) | no | no | easy | **yes — current cascade** |
| Behaviour Tree | structurally (branch order) | sequences only | no | medium | cascade ≈ flat Selector; §2 → reactive BT |
| Utility AI (IAUS) | **yes (scored)** | no | no | fiddly | **§3 target** |
| GOAP / HTN | yes | **yes** | (plan search) | hard | not used (no multi-step) |
| Minimax / MCTS | yes | implicitly | **yes** | eval fn | only the offline harness |
| RL | yes | learned | (training) | data/opaque | no |

### 4.9 Verdict & recommended order

The hero AI is a clean **per-role prioritized decision list** — i.e. a flattened
single-Selector behaviour tree. The two upgrades move it along the standard
industry path:

1. **Event-driven commitment first (§2).** Low-risk, high-feel: it makes the
   existing cascade *reactive* (the BT "interrupt decorator" pattern) and, just
   as importantly, becomes the **inertia/damper** that a utility system needs.
2. **Unified utility second (§3).** With the damper in place, collapse the
   genuinely-competing tiers into a scored pool (Utility AI / IAUS), keeping
   cart/pet/flee as hard rails. Migrate tier-by-tier, harness-calibrating each
   step.

We deliberately stop short of planning (GOAP/HTN) and search (MCTS): the game is
reactive, the world is cheap, and per-tick re-decision already yields emergent
multi-step behaviour. Those tools earn their cost only when actions gain strong
ordering dependencies or when an opponent must *out-think* the player — neither
of which this frontier sim needs today.
