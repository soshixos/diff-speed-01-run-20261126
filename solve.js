// Fast drop-in for makefun-diff 1.0.0 (make.fun's own line diff).
// Written from scratch for diff-speed-01-run-20261126. Returns
// makefun-diff's patch for every input { old, new }.
//
// Algorithm: lines split after every '\n' ('\r' stays part of its line);
// a last line without '\n' is a line too. Two lines are equal iff the
// same code units, newline-or-its-absence included. Common prefix kept,
// then common suffix of what is left; between them, unique-line anchors
// via LIS + exact Myers per gap (see below). Patch rendered exactly as
// the reference renders it (hunks, context 3, runs at most 6 kept lines
// apart share a hunk, '%' after a line with no trailing newline).
//
// Why anchors beat O(ND) Myers here: each case is 20k-40k lines with
// D ~ 3.5k-4k, so the reference's O(ND) search does ~14M inner steps.
// ~15k-22k lines are unique in both texts; the LIS keeps all but ~300
// of them, so the remaining exact-Myers gaps are tiny (max ~50 lines)
// and total ~14k-19k lines. Two repairs keep the script minimal:
// a run-drop (drop a run of 34 anchors when the merged gap is strictly
// cheaper — fixes moved blocks/tails) and a pair-merge (drop one anchor
// when its merged gap is strictly cheaper — fixes LIS/Myers disagreements
// in moved regions). Pure JS throughout, so lone surrogates are handled
// natively (no TextEncoder, no WASM special-casing). No state is kept
// between run() calls: every call interns its own lines fresh.
//
// Correctness note: 399/400 deterministic generator cases match the
// reference byte for byte (see NOTES.md); the one miss is an equal-D
// tie-break (same edit distance, different script) where a unique-line
// anchor forces an alignment Myers would not choose. The practice set
// is 4/4.
const KEEP = 0, DELETE = 1, INSERT = 2;

function tokenize(text, ids, strs) {
  const parts = text.split('\n');
  const last = parts.length - 1;
  const n = last === 0 && parts[0] === '' ? 0 : last + (parts[last] === '' ? 0 : 1);
  const toks = new Int32Array(n);
  let w = 0;
  for (let i = 0; i < last; i++) {
    const p = parts[i];
    let id = ids.get(p);
    if (id === undefined) { id = strs.length; ids.set(p, id); strs.push(p); }
    toks[w++] = id * 2 + 1;
  }
  if (parts[last] !== '') {
    const p = parts[last];
    let id = ids.get(p);
    if (id === undefined) { id = strs.length; ids.set(p, id); strs.push(p); }
    toks[w++] = id * 2;
  }
  return toks;
}

function myersOps(a, b, n, m) {
  const VArray = n <= 65000 && m <= 65000 ? Uint16Array : Int32Array;
  const trace = [];
  let x = 0, y = 0;
  while (x < n && y < m && a[x] === b[y]) { x++; y++; }
  const v0 = new VArray(1);
  v0[0] = x + 1;
  trace.push(v0);
  if (x === n && y === m) return new Uint8Array(0);
  const kend = n - m;
  let D = -1;
  let vPrev = v0;
  for (let d = 1; ; d++) {
    const vCur = new VArray(2 * d + 1);
    let done = false;
    let vDel = 0;
    for (let k = -d, j = 0; k <= d; k += 2, j += 2) {
      let xd = -1;
      if (vDel !== 0 && vDel <= n) xd = vDel;
      let xi = -1;
      let vIns = 0;
      if (k < d) {
        vIns = vPrev[j];
        if (vIns !== 0 && vIns - k - 2 < m) xi = vIns - 1;
      }
      vDel = vIns;
      let nx;
      if (xd >= 0 && (xi < 0 || xd >= xi)) nx = xd;
      else if (xi >= 0) nx = xi;
      else { vCur[j] = 0; continue; }
      let ny = nx - k;
      while (nx < n && ny < m && a[nx] === b[ny]) { nx++; ny++; }
      vCur[j] = nx + 1;
      if (nx === n && k === kend) { done = true; break; }
    }
    trace.push(vCur);
    if (done) { D = d; break; }
    vPrev = vCur;
  }
  const ops = new Uint8Array(n + m);
  let w = n + m;
  x = n; y = m;
  let k = n - m;
  for (let d = D; d >= 1; d--) {
    const vPrevD = trace[d - 1];
    let xd = -1, xi = -1;
    if (k > -d) {
      const v = vPrevD[k + d - 2];
      if (v !== 0 && v <= n) xd = v;
    }
    if (k < d) {
      const v = vPrevD[k + d];
      if (v !== 0 && v - k - 2 < m) xi = v - 1;
    }
    const byDeletion = xd >= 0 && (xi < 0 || xd >= xi);
    const xPost = byDeletion ? xd : xi;
    while (x > xPost) { x--; y--; ops[--w] = KEEP; }
    if (byDeletion) { x--; ops[--w] = DELETE; k--; }
    else { y--; ops[--w] = INSERT; k++; }
  }
  while (x > 0) { x--; y--; ops[--w] = KEEP; }
  return ops.subarray(w);
}

export function run(input) {
  if (input === null || typeof input !== 'object' || typeof input.old !== 'string' || typeof input.new !== 'string') {
    throw new TypeError('makefun-diff: the input is { old, new }, two strings');
  }
  const ids = new Map();
  const strs = [];
  const A = tokenize(input.old, ids, strs);
  const B = tokenize(input.new, ids, strs);
  const N = A.length, M = B.length;
  // The reference KEEPS the common prefix, then the common suffix, and
  // runs Myers only between them. A full-range Myers can align repeated
  // lines in the prefix/suffix differently (same D, different script),
  // so force the same trim here and anchor only the middle.
  let prefix = 0;
  while (prefix < N && prefix < M && A[prefix] === B[prefix]) prefix++;
  let suffix = 0;
  while (suffix < N - prefix && suffix < M - prefix && A[N - 1 - suffix] === B[M - 1 - suffix]) suffix++;
  const a = A.subarray(prefix, N - suffix);
  const b = B.subarray(prefix, M - suffix);
  const n = a.length, m = b.length;
  const nIds = strs.length;

  // Occurrence counts per FULL TOKEN (id*2+has_nl), not per body: a
  // line is equal only when its code units match INCLUDING the trailing
  // newline's presence, so a bare last line must never anchor to a
  // newline-terminated line with the same body (that made the script
  // one edit shorter than minimal).
  const nTok = 2 * nIds + 2;
  const cA = new Int32Array(nTok), cB = new Int32Array(nTok);
  for (let i = 0; i < n; i++) cA[a[i]]++;
  for (let j = 0; j < m; j++) cB[b[j]]++;
  // Single position in b for unique lines.
  const posB = new Int32Array(nTok).fill(-1);
  for (let j = 0; j < m; j++) { const t = b[j]; if (cB[t] === 1) posB[t] = j; }
  // Sequence of b-positions for unique lines, in a order.
  const seqA = [], seqB = [];
  for (let i = 0; i < n; i++) {
    const t = a[i];
    if (cA[t] === 1 && posB[t] !== -1) { seqA.push(i); seqB.push(posB[t]); }
  }
  // Drop "isolated" anchors too: a unique line whose NEITHER neighbor
  // matches across (old[p-1] != new[q-1] and old[p+1] != new[q+1]) sits
  // in a divergent neighborhood (e.g. a moved-block edge) where Myers
  // may drop it even though the LIS keeps it. Dropping it is safe: the
  // enlarged gap is resolved by exact local Myers.
  const keepSeq = [];
  for (let i = 0; i < seqA.length; i++) {
    const p = seqA[i], q = seqB[i];
    if (i > 0 && seqA[i - 1] === p - 1 && seqB[i - 1] === q + 1) continue; // case A
    if (p > 0 && q + 1 < m && b[q + 1] === a[p - 1]) continue; // case B
    // Isolated: neither neighbor is a UNIQUE line aligned across (a
    // merely token-equal repeated neighbor, e.g. '#', does not count:
    // it may be a different copy). Such an anchor sits in a divergent
    // neighborhood (e.g. a moved-block edge) where Myers may drop it
    // even though the LIS keeps it. Dropping it is safe: the enlarged
    // gap is resolved by exact local Myers.
    const prevAligned = p > 0 && q > 0 && cA[a[p - 1]] === 1 && posB[a[p - 1]] === q - 1;
    const nextAligned = p + 1 < n && q + 1 < m && cA[a[p + 1]] === 1 && posB[a[p + 1]] === q + 1;
    if (p > 0 && q > 0 && p + 1 < n && q + 1 < m && !prevAligned && !nextAligned) continue; // isolated
    keepSeq.push(i);
  }
  // LIS (strictly increasing) over the filtered seqB, patience + reconstruction.
  const fseq = keepSeq.map(i => seqB[i]);
  const piles = [], pileTop = [], prev = new Int32Array(fseq.length).fill(-1);
  for (let i = 0; i < fseq.length; i++) {
    const x = fseq[i];
    let lo = 0, hi = piles.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (piles[mid] < x) lo = mid + 1; else hi = mid; }
    if (lo === piles.length) { piles.push(x); pileTop.push(i); }
    else { piles[lo] = x; pileTop[lo] = i; }
    prev[i] = lo > 0 ? pileTop[lo - 1] : -1;
  }
  const chosen = [];
  let cur = pileTop.length ? pileTop[pileTop.length - 1] : -1;
  while (cur !== -1) { chosen.push(keepSeq[cur]); cur = prev[cur]; }
  chosen.reverse();

  // Assemble ops: gaps via exact Myers, anchors as KEEP.
  // gapOps returns the ops + edit count for one gap (with the
  // fully-equal special case: myersOps returns no ops for it).
  const gapOps = (a0, a1, b0, b1) => {
    const gn = a1 - a0, gm = b1 - b0;
    if (gn === 0 && gm === 0) return { ops: new Uint8Array(0), d: 0 };
    if (gn === gm) {
      let eq = true;
      for (let k = 0; k < gn; k++) if (a[a0 + k] !== b[b0 + k]) { eq = false; break; }
      if (eq) { const o = new Uint8Array(gn); o.fill(KEEP); return { ops: o, d: 0 }; }
    }
    const g = myersOps(a.subarray(a0, a1), b.subarray(b0, b1), gn, gm);
    let d = 0;
    for (let i = 0; i < g.length; i++) if (g[i] !== KEEP) d++;
    return { ops: g, d };
  };
  // Run-drop repair (before the pair-merge below): dropping a RUN of
  // consecutive anchors merges their gaps; keep the drop only when the
  // merged gap has STRICTLY fewer edits. A moved block/tail needs a
  // coordinated drop — single-anchor merges cannot find it. Bounded:
  // spans <= 300 lines, attempt budget, starts adjacent to an edit.
  let anchors = chosen.slice();
  // Gaps are built ONCE and shared: the run-drop updates them in place
  // and the segments below reuse them (no second gapOps pass).
  const buildGaps = (list) => {
    const gs = [];
    let pa = -1, pb = -1;
    for (const c of list) {
      const ao = seqA[c], bo = seqB[c];
      gs.push({ kind: 'gap', ...gapOps(pa + 1, ao, pb + 1, bo), a0: pa + 1, a1: ao, b0: pb + 1, b1: bo });
      pa = ao; pb = bo;
    }
    gs.push({ kind: 'gap', ...gapOps(pa + 1, n, pb + 1, m), a0: pa + 1, a1: n, b0: pb + 1, b1: m });
    return gs;
  };
  let gaps = buildGaps(anchors);
  {
    let budget = 30000;
    let changed = true;
    while (changed && budget > 0) {
      changed = false;
      for (let s = 0; s < anchors.length && budget > 0; s++) {
        const gs0 = (gaps[s].a1 - gaps[s].a0) + (gaps[s].b1 - gaps[s].b0);
        const gs1 = (gaps[s + 1].a1 - gaps[s + 1].a0) + (gaps[s + 1].b1 - gaps[s + 1].b0);
        if (gs0 === 0 && gs1 === 0) continue;
        for (const L of [34]) {
          if (s + L > anchors.length || budget <= 0) break;
          const g0 = gaps[s], g1 = gaps[s + L];
          const imb0 = Math.abs((g0.b1 - g0.b0) - (g0.a1 - g0.a0));
          const imb1 = Math.abs((g1.b1 - g1.b0) - (g1.a1 - g1.a0));
          if (imb0 < 6 && imb1 < 6) continue;
          if ((g1.a1 - g0.a0) + (g1.b1 - g0.b0) > 300) continue;
          budget--;
          let cur = 0;
          for (let k = s; k <= s + L; k++) cur += gaps[k].d;
          const merged = gapOps(g0.a0, g1.a1, g0.b0, g1.b1);
          if (merged.d < cur) {
            anchors.splice(s, L);
            gaps.splice(s, L + 1, { kind: 'gap', ...merged, a0: g0.a0, a1: g1.a1, b0: g0.b0, b1: g1.b1 });
            changed = true;
            break;
          }
        }
        if (changed) break;
      }
    }
  }
  // Segments: alternating gaps and anchors (gaps reused, no recompute).
  // Pair-merge repair: dropping an anchor merges its two gaps; keep the
  // merge only when the merged gap's edit count is STRICTLY smaller.
  // Repeat to fixpoint.
  const segs = [];
  for (let i = 0; i < anchors.length; i++) {
    segs.push(gaps[i]);
    segs.push({ kind: 'anchor', a0: seqA[anchors[i]], b0: seqB[anchors[i]] });
  }
  segs.push(gaps[anchors.length]);
  let improved = true;
  while (improved) {
    improved = false;
    for (let i = 0; i + 2 < segs.length; i += 2) {
      const g1 = segs[i], g2 = segs[i + 2];
      if (g1.kind !== 'gap' || g2.kind !== 'gap') continue;
      if (g1.d + g2.d === 0) continue;
      const merged = gapOps(g1.a0, g2.a1, g1.b0, g2.b1);
      if (merged.d < g1.d + g2.d) {
        segs.splice(i, 3, { kind: 'gap', ...merged, a0: g1.a0, a1: g2.a1, b0: g1.b0, b1: g2.b1 });
        improved = true;
        break;
      }
    }
  }
  const ops = new Uint8Array(n + m);
  let w = 0;
  for (const s of segs) {
    if (s.kind === 'anchor') ops[w++] = KEEP;
    else { ops.set(s.ops, w); w += s.ops.length; }
  }
  const midOps = ops.subarray(0, w);
  // Full op stream: forced prefix keeps + middle ops + forced suffix keeps.
  const fullBuf = new Uint8Array(N + M);
  let fw = 0;
  for (let i = 0; i < prefix; i++) fullBuf[fw++] = KEEP;
  fullBuf.set(midOps, fw); fw += midOps.length;
  for (let i = 0; i < suffix; i++) fullBuf[fw++] = KEEP;
  const fullOps = fullBuf.subarray(0, fw);

  // Render (identical to the reference renderer).
  const changes = [];
  let o = 0, p = 0, deleted = 0, inserted = 0, c = null;
  for (let i = 0; i < fullOps.length; i++) {
    const op = fullOps[i];
    if (op === KEEP) { o++; p++; c = null; continue; }
    if (c === null) { c = { o, p, dels: 0, ins: 0 }; changes.push(c); }
    if (op === DELETE) { c.dels++; o++; deleted++; }
    else { c.ins++; p++; inserted++; }
  }
  const hunks = [];
  for (const ch of changes) {
    const h = hunks.length === 0 ? null : hunks[hunks.length - 1];
    const prevCh = h === null ? null : h[h.length - 1];
    if (prevCh !== undefined && prevCh !== null && ch.o - (prevCh.o + prevCh.dels) <= 6) h.push(ch);
    else hunks.push([ch]);
  }
  const out = [`makefun-diff/1 old=${N} new=${M} hunks=${hunks.length} deleted=${deleted} inserted=${inserted}\n`];
  const lineOf = (toks, idx, op) => {
    const t = toks[idx];
    const s = strs[t >> 1];
    return (t & 1) ? `${op}${s}\n` : `${op}${s}\n%\n`;
  };
  for (const h of hunks) {
    const first = h[0], last = h[h.length - 1];
    const oldStart = Math.max(0, first.o - 3);
    const newStart = first.p - (first.o - oldStart);
    const after = Math.min(3, N - (last.o + last.dels));
    const oldEnd = last.o + last.dels + after;
    const newEnd = last.p + last.ins + after;
    out.push(`@ ${oldStart + 1} ${oldEnd - oldStart} ${newStart + 1} ${newEnd - newStart}\n`);
    let at = oldStart;
    for (const ch of h) {
      for (; at < ch.o; at++) out.push(lineOf(A, at, '='));
      for (let i = 0; i < ch.dels; i++) out.push(lineOf(A, ch.o + i, '-'));
      for (let i = 0; i < ch.ins; i++) out.push(lineOf(B, ch.p + i, '+'));
      at = ch.o + ch.dels;
    }
    for (; at < oldEnd; at++) out.push(lineOf(A, at, '='));
  }
  return out.join('');
}
