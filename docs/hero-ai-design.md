# Hero AI implementation plan

Status: Phase 1 and the fighter slice of Phase 2 are complete. The other roles
and conditional raid response remain. This plan describes the current
`index.html` and the remaining work. Keep tactical combat and role identity as hard rules;
use scores only where a hero has a genuine strategic choice.

## Current baseline

- `chooseGoal` keeps a path-bearing goal until arrival, blockage, injury, or
  target loss. The former two-turn timer has been removed from ordinary goals.
- Fighters compare hunt, shop, lair, and patrol candidates on one scale. Other
  roles retain the tier cascade; their scores compare within a tier.
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

Do not create a single all-role pool. The fighter now compares `hunt`, `shop`,
`lair`, and `patrol`, including kill/hunt and lair bounty variants. Bounties
carry a strong reward term but are not an absolute override. The candidate
pass keeps two hunts and one option from each other family, checks land
connectivity before pathfinding, and generates exploration/idle fallbacks only
if every scored option lacks a usable route. Next: monster hunter, ranger, then
rogue, one role at a time. Guards, carts, and pets stay outside this migration.

The implemented fighter scale uses `D = min(1, distance / 40)`,
`R = min(1, reward / BOUNTY_MAX)`, normalized combat odds, and the same 0..1
clamping for threat near a patrol flag. Scores before hard eligibility checks:

| Family | Score |
|---|---|
| Hunt | `145 + 25·evil + 40·raider + 20·win - 35·D - 10·homeDistance/24` |
| Kill/hunt bounty | `160 + 45·R + 10·evil + 15·raider - 35·D - 20·outmatched` |
| Ordinary lair | `155 + 10·undead - 35·D` |
| Lair bounty | `165 + 10·undead + 45·R - 35·D` |
| Shop | `120 + (30 if gear, else 15 for potion) + 10·purse/150 - 35·D` |
| Patrol bounty | `125 + 45·R + 15·localDanger - 35·D` |

An active bounty always raises that lair's score. Close winnable hunts beat a
useful shop trip; a distant minor hunt does not. A paid patrol remains a hold
order after reaching its center and ends when the flag pays or is cancelled.

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

Fighter result across two fixed 30×150 seed sets: paid patrols rose from 51 to
94 total; shop income rose about 11%; collapse remained 13/60 games. Lairs
cleared fell from 30 to 27 and hero deaths rose from 123 to 129 across those
games. These smaller differences need watching in later role changes. The
second seed set kept lair clears unchanged (16 each). A→B→A switches within
one big turn occurred 10 times across the 60 games. Combined path calls rose
about 0.9%. The focused probe covers close/distant hunts,
shopping, patrol presence, lair bounty value, and the Phase 1 event cases.
Fresh fighter kill/hunt goals require a visible target, so they never learn a
hidden hostile's current position. A flag whose target becomes visible after
its bounty revision was examined can wait until the fighter's next ordinary
goal decision; a scoped visibility event is a possible follow-up if this is
noticeable in play.

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
