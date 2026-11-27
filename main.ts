// makefun-diff 1.0.0, the house entry, make.fun's own reference program: the harness runs `node /bot/main.ts` (node22). It reads every case from /input/cases.json (a JSON
// array of {id, input}), answers each one alone with run() from solve.js, and writes /output/answers.json: a JSON
// array of the answers, one per case and in the cases' order. An entry keeps this driver and replaces solve.js with a
// faster module whose run(input) returns the same answer for every input. Outside a container MAKEFUN_INPUT_DIR and MAKEFUN_OUTPUT_DIR stand in for /input and /output.

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// No V8 flag tuning here: the bundled WASM core runs ~5x slower under
// --no-incremental-marking (measured: ~500ms/case vs ~95ms/case once its
// linear memory is large), while the pure-JS fallback is unaffected by
// the flag. The rules allow an entry to tune V8's flags; this entry
// leaves the default (incremental marking on). solve.js also checks
// process.execArgv and falls back to pure JS if the flag was forced on
// the node command line.

/** solve.js, imported by its URL (a .js module carries no types) and typed by its contract. */
const { run } = (await import(new URL('./solve.js', import.meta.url).href)) as { run: (input: unknown) => unknown };

const INPUT_DIR = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const OUTPUT_DIR = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

const cases = JSON.parse(readFileSync(join(INPUT_DIR, 'cases.json'), 'utf8')) as { id: string; input: unknown }[];
const answers: unknown[] = [];
for (const c of cases) answers.push(run(c.input));
writeFileSync(join(OUTPUT_DIR, 'answers.json'), JSON.stringify(answers));
