# diff-speed-01-run-20261126 — build notes

Entry for make.fun "Diff two texts faster, 27 November 2026" ($100, top 10 × $10).
Deadline: 29 Nov 2026 13:07 WIB (06:07 UTC). Final set drawn from drand round 34376552.

## What it is

A faster drop-in for makefun-diff 1.0.0. `solve.js` is an ES module whose
`run(input)` returns makefun-diff's patch for `{ old, new }`, byte-identical.

Two implementations in one file, same algorithm, same script:

1. **WASM fast path** (default): a Rust core (`wasm-src/src/lib.rs`, compiled
   to WASM, embedded as base64 in `solve.js`) that tokenizes, runs Myers and
   renders the patch in native code.
2. **Pure-JS fallback** (`runJS` in `solve.js`): used when WASM cannot load,
   when a call traps, when the input contains lone surrogates (which
   `TextEncoder` would lossy-replace), and when `--no-incremental-marking`
   was forced on the node command line (see below).

Algorithm (identical script to the reference, by construction): lines split
after every `\n` (`\r` stays part of its line); a last line without `\n` is a
line too; common prefix kept, then common suffix; between them Myers's greedy
search — furthest into the old text wins per diagonal, deletion wins ties,
no move past either text's end, every equal run followed as far as it goes;
first path to reach both ends is the script. Patch rendered exactly as the
reference renders it (hunks, context 3, runs ≤ 6 kept lines apart share a
hunk, `%` after a line with no trailing newline).

Speed tricks: lines interned to small integer tokens (one int compare per
snake step); the search runs on typed arrays with a full V trace for
backtracking (Uint16 while the texts stay under 65,535 lines, Int32 above);
backtrack pins each step's post-edit point from V[d-1], never from line
equality. No state is kept between `run()` calls.

## Correctness evidence

- Kit `grade-local --driver process`: **4/4 practice cases pass, L1 regrade
  reproduced byte for byte** (commit ee6e9b5).
- Fuzz vs the reference: 3,000 small random cases + 60 generator-like
  medium cases (200–2,000 lines, CRLF/bare endings, repeats, moves) +
  20 targeted edges (empty texts, lone `\n`, no trailing newline, CRLF,
  emoji/surrogate pairs, lone surrogates, 100 KB single lines, 5,000
  repeated lines, reversed texts) — **0 mismatches**.
- Determinism: same input twice gives identical bytes (the harness runs
  each entry twice and requires byte-identical outputs).

## Benchmarks (this VM, Node 24.22.1; harness uses Node 22)

Fresh-process runs of `node main.ts` on the practice set (4 cases),
median of 7 runs, CPU time:

| entry | CPU total | net of null control (~211 ms) |
|---|---|---|
| house baseline (makefun-diff 1.0.0) | 1,779 ms | 1,568 ms |
| this entry (WASM path) | 615 ms | 404 ms |
| this entry (pure-JS fallback) | 848 ms | 637 ms |

Scored ratio (net of null): **~3.9x faster than the baseline** (WASM path),
~2.5x (pure-JS fallback). Per case, WASM path: ~60–90 ms CPU vs
baseline ~290–550 ms. The entry beats the baseline at well over 95%
confidence on the practice set; the final set is drawn from a different
drand round but the same generator, so the same shape is expected.

## The `--no-incremental-marking` finding

`main.ts` deliberately does NOT set `--no-incremental-marking` (the house
baseline's driver does). Measured: with that flag, the WASM core runs
~5x slower (~450–550 ms/case vs ~60–90 ms/case) once its linear memory
is large (~100 MB), while the pure-JS implementation is unaffected by the
flag (491 ms vs 493 ms total over 4 cases). The rules allow an entry to
tune V8's flags, so this entry leaves the default (incremental marking
on). `solve.js` also checks `process.execArgv`: if the flag was forced on
the node command line, it stays on pure JS.

## Repo

- Size: ~250 KB total (cap 1 MiB). `solve.js` ~205 KB (of which ~193 KB
  is the base64 WASM blob), Rust source in `wasm-src/` (excluded:
  `wasm-src/target/`).
- Anchor: root commit `0793db7` (drand round 34325458, wallet
  `An4J2AMJenmELVHboUgvQfmHAto8QXt6Mu718pdqvZpK`).
- Build commit: `ee6e9b5` (+ NOTES.md/README.md on top).
- Rebuild the WASM: `cargo build --release --target wasm32-unknown-unknown`
  in `wasm-src/` (Rust 1.74.1 + wasm32-unknown-unknown std, installed
  manually from static.rust-lang.org), then re-embed the base64 into
  `solve.js` (replace the `WASM_B64` string) and re-run the fuzz +
  practice checks before committing.

## Before submit (parent)

See `../diff-speed-01-run-20261126-SUBMIT-HANDOFF.md`: create/push the
GitHub repo (or enter via `--source` bundle), add the README badges +
About, bundle transcripts, run `makefun check`, then submit before
29 Nov 2026 13:07 WIB. Do NOT submit without Yuni's approval.
