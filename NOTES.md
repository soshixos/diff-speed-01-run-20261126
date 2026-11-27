# diff-speed-01-run-20261126 — build notes

Entry for make.fun "Diff two texts faster, 27 November 2026" ($100, top 10 × $10).
Deadline: 29 Nov 2026 13:07 WIB (06:07 UTC). Final set drawn from drand round 34376552.

## What it is

A faster drop-in for makefun-diff 1.0.0. `solve.js` is an ES module whose
`run(input)` returns makefun-diff's patch for `{ old, new }`.

Algorithm: lines split after every `\n` (`\r` stays part of its line); a
last line without `\n` is a line too. Two lines are equal iff the same
code units, newline-or-its-absence included. Common prefix kept, then
common suffix of what is left; between them, unique-line anchors via LIS
+ exact Myers per gap. Patch rendered exactly as the reference renders it
(hunks, context 3, runs ≤ 6 kept lines apart share a hunk, `%` after a
line with no trailing newline). Pure JS throughout, so lone surrogates are
handled natively (no TextEncoder, no WASM special-casing). No state is
kept between `run()` calls: every call interns its own lines fresh.

Why anchors beat O(ND) Myers here: each case is 20k-40k lines with
D ~ 3.5k-4k, so the reference's O(ND) search does ~14M inner steps.
~15k-22k lines are unique in both texts; the LIS keeps all but ~300 of
them, so the remaining exact-Myers gaps are tiny (max ~50 lines) and total
~14k-19k lines. Details that keep the script identical to the reference:

- Uniqueness is keyed by FULL token (line body + newline presence), so a
  bare last line never anchors to a newline-terminated line with the same
  body.
- Adjacent-swap drops: when the LIS would keep the second of two swapped
  unique lines (Myers keeps the first), or a unique line crossed a
  repeated line (Myers keeps the repeated one), the unique line is dropped
  before the LIS.
- Isolated-anchor drop: a unique line whose neither neighbor is a unique
  line aligned across is dropped (it sits in a divergent neighborhood,
  e.g. a moved-block edge, where Myers may drop it).
- Run-drop repair: dropping a run of 34 consecutive anchors is kept only
  when the merged gap has STRICTLY fewer edits (fixes moved blocks/tails);
  attempts are limited to starts whose bounding gaps have a large old/new
  imbalance (≥ 6), span ≤ 300 lines, budget 30,000.
- Pair-merge repair: dropping one anchor is kept only when its merged gap
  has STRICTLY fewer edits; pairs with no edits are skipped; repeat to
  fixpoint. Gaps are built once and shared (run-drop updates them in
  place, segments reuse them — no second gapOps pass).

## Correctness evidence

- Kit `grade-local --driver process`: **4/4 practice cases pass, L1
  regrade reproduced byte for byte**.
- Deterministic fuzz vs the reference (generator, seed
  sha256(`'anchor-fuzz-v1'` + set), 4 cases/set): **399/400 cases match
  byte for byte** (sets 0-99). The one miss is set 66 case 0: an equal-D
  tie-break — the anchor's script has the SAME edit distance as the
  reference (1107 hunks, 1852 deleted, 2266 inserted) but a different
  alignment, because a unique-line anchor forces an alignment Myers would
  not choose (Myers keeps a repeated line the anchor's gap deletes).
  Per-case failure rate 0.25%, so a 4-case set has ~1% chance of
  containing such a case. The practice set is 4/4.
- Port check: the repo's `solve.js` matches the prototype on the same
  100-case fuzz (0 mismatches, sets 0-24) and reproduces the set 66 miss
  identically.
- Targeted edge cases 18/18 pass: empty texts, bare endings, CRLF, lone
  surrogates (differing and matching), emoji pairs, 100 KB single lines,
  5,000 repeated lines (kept and shrunk), full reversals, unique-vs-
  repeated swaps.
- Determinism: same input twice gives identical bytes (the harness runs
  each entry twice and requires byte-identical outputs).

## Benchmarks (this VM, Node 24.22.1; harness uses Node 22)

Head-to-head in one process, interleaved, 10 reps over the 4 practice
cases (median total for 4 cases, run() only, no startup/JSON):

| entry | median total (4 cases) | per case |
|---|---|---|
| previous entry (WASM Myers core) | 347 ms | ~87 ms |
| this entry (anchor+LIS, pure JS) | 296 ms | ~74 ms |

Speedup: **~1.17x over the previous entry** (~1.4x in fuzz averages,
which include oracle overhead). Fresh-process `node main.ts` on the
practice set (CPU, median of 7): 842 ms total including Node startup +
cases.json parse + answers.json stringify/write; the previous entry
measured 615 ms the same way in an earlier, quieter VM period, so the
cross-period totals are not directly comparable — the same-process
head-to-head above is the reliable number. The house baseline
(makefun-diff 1.0.0) measured 1,779 ms total / 1,568 ms net of the null
control (~211 ms) in the earlier period, so this entry is roughly
5x faster than the baseline on run() time.

Leaderboard context (27 Nov 2026): the top entries all show cpu_us 0
("< 10 ms") — a clock-tick artifact (net CPU under one 10 ms tick reads
0) and/or dev-board-only gaming (e.g. hardcoding the public practice
answers gives 0 and 4/4 on dev but fails the final set drawn from a
different drand round). This entry wins on real speed within the rules;
the final heat (1 warm-up + 9 timed rounds, trimmed mean) on the unseen
set is what matters.

## Repo

- Size: ~30 KB total (cap 1 MiB). `solve.js` ~14.5 KB (pure JS, no WASM
  blob). The old WASM core's Rust source is retained in `wasm-src/` for
  reference only; the WASM path was removed in this commit (the anchor
  is faster than the WASM Myers core, and pure JS handles lone
  surrogates natively).
- Anchor: root commit `0793db7` (drand round 34325458, wallet
  `An4J2AMJenmELVHboUgvQfmHAto8QXt6Mu718pdqvZpK`).
- Previous build (WASM entry): commit `af7e4dd`
  (af7e4dd7d242d84dd772ae2111ab1fab5159b92f).
- This build: anchor+LIS pure-JS entry (commit below).

## Before submit (parent)

See `../diff-speed-01-run-20261126-SUBMIT-HANDOFF.md`: bundle transcripts,
run `makefun check`, then submit before 29 Nov 2026 13:07 WIB. Do NOT
submit without Yuni's approval. Note the 1/400 equal-D caveat above when
deciding — the previous (exact, slower) entry remains in git history at
`af7e4dd` if a revert is wanted.
