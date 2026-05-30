Write performant JS: evade temp allocations, prefer using typed buffers and batch operations where appropriate. Do not use complicated and known slow JS features.

The main target platform is mobile, be aware of limited screen area while designing UIs. Also be mindful about rendering performace: this is mostly a text-only game, it should run smoothly on a toaster.

The game is a hobby project, not a tripple A thing. Do not try to blow the scope out of proportion when designing game fatures.

## Simulation harness

Use the batch harness when changing actor goals, pathfinding, hostile movement, combat, exploration, or economy balance:

```sh
node scripts/sim-harness.mjs --games 10 --turns 100
```

Useful variants:

```sh
node scripts/sim-harness.mjs --games 30 --turns 150
node scripts/sim-harness.mjs --games 10 --turns 100 --seed 12345 --json
```

The harness is dependency-free. It evaluates `index.html` in a tiny fake DOM and calls `window.__lorTest`, so it bypasses rendering, animation, browser clicks, and console report spam. It reports scout death rate/average death turn, discovery speed, food totals, combats, hostile kills, food hunt events, ruin searches, and the seeds used. If a sim run looks suspicious, rerun with `--json` and inspect per-seed results.

For performance work, use a fixed seed before and after the change so the run doubles as a regression detector:

```sh
node scripts/sim-harness.mjs --games 10 --turns 100 --seed 1592594996
```

Watch the performance block: `turns/sec`, `avg turn compute`, `avg goal selection`, `avg pathfind`, `path calls/turn`, `candidate cells/goal`, and `candidates/goal`. If gameplay metrics move, make sure the behavior change is intentional and explain it.
