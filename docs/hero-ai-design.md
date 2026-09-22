# Hero AI implementation plan

Status: Phase 1 complete; Phase 2 is next. This plan describes the current
`index.html` and the remaining work. Keep tactical combat and role identity as hard rules;
use scores only where a hero has a genuine strategic choice.

## Current baseline

- `chooseGoal` keeps a path-bearing goal until arrival, blockage, injury, or
  target loss. The former two-turn timer has been removed from ordinary goals.
- Candidates are sorted by utility, but `generateGoalCandidates` returns after
  the first applicable role tier. Scores currently compare candidates within
  that tier, not across tiers.
- Hostile, lair, and village goals carry `targetKind`/`targetId`; bounty goals
  also carry `bountyId`. Visible hostile moves update the route; unseen moves
  leave the last seen destination intact.
- The harness reports goal lifecycle, event checks, candidate counts, path
  calls, and timings. `--probe-goals` exercises key event transitions.
- Fight/flee is decided in `computeTurnPlan` before `chooseGoal`. Adjacent
  threats must remain in that tactical layer.

## Rules that apply to every phase

1. Path commitment is the default. No periodic full rescore. Emergency tactical
   decisions and explicit events may interrupt it.
2. `wantsRest` remains mandatory, including its full-heal latch. Cart delivery,
   pet behavior, guards' home defense, and tactical fleeing remain hard rails.
3. A goal with a destroyed entity or cancelled bounty is invalid. For a moving
   hostile, replan to its new position only while that cell is visible. Otherwise
   travel to the last seen position; on arrival, choose again. Never use hidden
   coordinates to steer a hero.
4. Event revisions are monotonic counters, not `game.turn` stamps. Each actor
   records the last revision it **examined** even when it keeps its goal. A new
   event may be delayed by a one-big-turn opportunity floor, but must remain
   pending until examined. Tactical emergencies bypass that floor.
5. Compare an eligible new candidate with the **incumbent goal**. Switch only
   when `newUtility > incumbentUtility + margin` and the new target differs.
   Preserve the incumbent otherwise. This is the hysteresis rule; a bonus in
   candidate generation alone would have no effect while `chooseGoal` returns
   valid goals early.
6. Before pathfinding, reject candidates on disconnected land components where
   applicable. Keep a bounded list, but reserve at least one reachable fallback
   for each competing goal family; a global top-N list can fill with unreachable
   high scores and hide a valid lower option.

## Phase 1 — goal lifecycle and event commitment (complete)

Implemented in `index.html`:

1. Give bounty-derived candidates and goals a `bountyId`. Check its continued
   presence in `goalIsValid`; cancellation should release a hero on its next
   strategic decision. Increment `game.bountyRevision` only when a bounty is
   posted, raised, cancelled, completed, or swept.
2. When a visible hostile with `targetId` moves, replan and replace the saved
   target/path together. If it moves outside vision, keep the last seen target.
   Count target refreshes separately from goal switches.
3. For a hero with a still-valid goal and a new bounty revision, examine the
   role's current bounty tier once. If a different reachable bounty clears the
   hysteresis margin, switch. Otherwise record the revision as examined. Do not
   call pathfinding merely to score each bounty. This first slice respects the
   current tier cascade; cross-tier comparison belongs to Phase 2.
4. Count retained goals, event checks, event switches, target loss, arrival, and
   blockage separately. Expose goal selection, candidate, and path timings in
   the normal harness report.

Acceptance:

- Same-turn bounty changes are noticed after the opportunity floor.
- A weaker new bounty is checked once, then does not cause repeat scoring.
- Cancellation drops a bounty goal even if its hostile/lair remains alive.
- A visible target move updates both destination and route; an unseen move
  does not reveal its coordinates.
- Existing tactical fight/flee and `wantsRest` behavior remain intact.

The fixed-seed 10×100 run after this phase had the same 10% collapse rate and
0.6 hero deaths/game as the previous baseline. Path calls fell from 3.372 to
3.365 per sub-turn; average compute rose from 0.980 to 1.006 ms per sub-turn
(about 3%). Goal invalidation counts are not directly comparable because the
new report includes direct movement blockages. The 30×150 balance run and
`--probe-goals` pass. That balance run recorded 304 bounty event checks and 58
event switches across all 30 games. The shorter fixed-seed run had no bounty
event checks, which is why the focused probe is part of the acceptance gate.

## Phase 2 — partial utility, one role group at a time

Do not create a single all-role pool. Start with the fighter's genuinely
competing `hunt`, `shop`, `lair`, and `patrol` families. Keep bounties as explicit
player steering with a strong reward term. Extend only after the fighter group
behaves well: monster hunter, ranger, then rogue. Guards, carts, and pets are
outside this migration.

For each family, specify in code beside its scorer:

| Family | Eligibility | Main benefit | Main cost / risk | Completion |
|---|---|---|---|---|
| Hunt | visible, winnable hostile; fighter range limit | evil/raider threat, bounty | path distance, combat odds | target dies or disengages |
| Lair | discovered, active, reachable, assault-ready | lair/bounty reward | distance, injury risk | lair destroyed |
| Shop | useful affordable purchase, no adjacent lair | gear or potion need | travel, abandoned defense | reaches keep and buys or cannot buy |
| Patrol | live reachable flag | reward, defense | travel, time on station | flag paid or cancelled |

Use a small weighted sum with a shared score range; keep zero/one eligibility
checks outside scoring. Do not reinterpret `GOAL_UTIL` as ceilings, because that
can preserve the old priority order. Normalize distance, reward, health, and
odds; write the weights and score ranges down before tuning. Score every
eligible candidate in the group, then choose the highest reachable candidate.
If the incumbent belongs to the group, include it in the comparison and apply
the same switch margin. Limit work by family before merging sorted candidates.

Completion rules must stay tied to the actual activity. In particular, a
`patrol` goal should not be treated as complete merely because its center tile
was reached: the bounty needs `PATROL_TURNS` of nearby presence.

Acceptance for each role merge: fewer missed useful shops/patrols and no
material loss in survival, lair progress, scouting, or role identity. Revert a
merge whose benefit is not clear after calibration.

## Phase 3 — raid response (conditional)

Do not interrupt every hero when a raid wave spawns. First measure whether
existing patrol bounties and visible-raider hunts reach threatened settlements
in time. The fixed-seed baseline previously completed no patrol flags, so
diagnose that path before treating raid alarms as a hero command. If response is
still weak, add a bounded emergency-defense candidate for nearby fighters only.
Specify response radius, target, completion condition, and priority relative to
player patrol flags. Use a scoped raid revision, and examine it once per actor.

## Verification and tuning

Before and after each behavior change, run:

```sh
node scripts/sim-harness.mjs --games 10 --turns 100 --seed 1592594996
node scripts/sim-harness.mjs --games 30 --turns 150
node scripts/sim-harness.mjs --probe-goals
```

Compare deaths, collapse, discovery, food, kills, bounty completion, lairs,
shops, goal switches, candidate count, path calls, average turn/goal/path time.
Use `--json` to inspect seeds with unusual outcomes. Add focused deterministic
probes for same-turn bounty raise/cancel, a weaker bounty, visible/unseen target
movement, and repeated A→B→A switches; aggregate balance runs cannot prove
those transitions.

Initial performance guardrails are roughly 10% average turn compute and 20%
path calls per turn. These are investigation thresholds, not reasons to discard
a clear gameplay improvement. Keep scoring and event checks allocation-light;
avoid pathfinding for every bounty and do not scan every goal family on every
sub-turn.
