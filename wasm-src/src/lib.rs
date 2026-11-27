// Fast drop-in for makefun-diff 1.0.0, WASM core.
// Port of the JS implementation in ../solve.js (same algorithm, same
// tie-break, same rendering), operating on UTF-8 bytes: splitting on
// byte 0x0A and comparing byte slices is exactly JS's split('\n') and
// code-unit line equality, for every input without lone surrogates
// (the JS side falls back to the pure-JS implementation then).
// The Myers search, trace and backtrack mirror the JS code exactly.

use std::collections::HashMap;
use std::hash::{BuildHasherDefault, Hasher};

// ---- a fast Fx-style hasher for byte-slice keys ----
#[derive(Default)]
struct FxHasher {
    hash: u64,
}
const FX_SEED: u64 = 0x51_7c_c1_b7_27_22_0a_95;
impl Hasher for FxHasher {
    #[inline]
    fn write(&mut self, bytes: &[u8]) {
        let mut h = self.hash;
        let mut chunks = bytes.chunks_exact(8);
        for c in &mut chunks {
            let v = u64::from_le_bytes(c.try_into().unwrap());
            h = (h.rotate_left(5) ^ v).wrapping_mul(FX_SEED);
        }
        let rem = chunks.remainder();
        if !rem.is_empty() {
            let mut buf = [0u8; 8];
            buf[..rem.len()].copy_from_slice(rem);
            let v = u64::from_le_bytes(buf);
            h = (h.rotate_left(5) ^ v).wrapping_mul(FX_SEED);
        }
        self.hash = h;
    }
    #[inline]
    fn finish(&self) -> u64 {
        self.hash
    }
}
type FxMap<K, V> = HashMap<K, V, BuildHasherDefault<FxHasher>>;

const KEEP: u8 = 0;
const DELETE: u8 = 1;
const INSERT: u8 = 2;

/// Tokenize + intern one text. Lines are split after every 0x0A; the
/// last part is a line only when non-empty. Token = id * 2 + has_nl.
fn tokenize<'a>(text: &'a [u8], ids: &mut FxMap<&'a [u8], u32>, strs: &mut Vec<&'a [u8]>) -> Vec<u32> {
    let mut toks: Vec<u32> = Vec::with_capacity(text.len() / 16 + 1);
    let mut start = 0usize;
    let mut i = 0usize;
    while i < text.len() {
        if text[i] == b'\n' {
            let body = &text[start..i];
            let id = match ids.get(body) {
                Some(&id) => id,
                None => {
                    let id = strs.len() as u32;
                    ids.insert(body, id);
                    strs.push(body);
                    id
                }
            };
            toks.push(id * 2 + 1);
            start = i + 1;
        }
        i += 1;
    }
    if start < text.len() {
        let body = &text[start..];
        let id = match ids.get(body) {
            Some(&id) => id,
            None => {
                let id = strs.len() as u32;
                ids.insert(body, id);
                strs.push(body);
                id
            }
        };
        toks.push(id * 2);
    }
    toks
}

/// Myers edit ops for token slices: KEEP/DELETE/INSERT per consumed line.
/// Generated for u16 and u32 traces; the trace stores X + 1 (or 0 for no
/// path), so u16 suffices while the texts stay under 65,535 lines.
macro_rules! myers_ops_impl {
    ($name:ident, $t:ty) => {
        fn $name(a: &[u32], b: &[u32]) -> Vec<u8> {
    let n = a.len();
    let m = b.len();
    // Trace: V[d][k] stores X + 1 (X = old lines consumed), or 0.
    let mut trace: Vec<Vec<$t>> = Vec::new();
    let mut x = 0usize;
    let mut y = 0usize;
    while x < n && y < m && a[x] == b[y] {
        x += 1;
        y += 1;
    }
    let mut v0 = vec![0 as $t; 1];
    v0[0] = (x + 1) as $t;
    trace.push(v0);
    if x == n && y == m {
        return Vec::new();
    }
    let kend = n as i64 - m as i64;
    let mut d_found = 0usize;
    for d in 1usize.. {
        let mut v_cur = vec![0 as $t; 2 * d + 1];
        let v_prev = &trace[d - 1];
        let mut v_del: $t = 0;
        let mut done = false;
        let mut k = -(d as i64);
        let mut j = 0usize;
        while k <= d as i64 {
            let mut xd: i64 = -1;
            if v_del != 0 && (v_del as usize) <= n {
                xd = v_del as i64;
            }
            let mut xi: i64 = -1;
            let mut v_ins: $t = 0;
            if k < d as i64 {
                v_ins = v_prev[j];
                if v_ins != 0 && (v_ins as i64) - k - 2 < m as i64 {
                    xi = v_ins as i64 - 1;
                }
            }
            v_del = v_ins;
            let nx: usize;
            if xd >= 0 && (xi < 0 || xd >= xi) {
                nx = xd as usize;
            } else if xi >= 0 {
                nx = xi as usize;
            } else {
                v_cur[j] = 0 as $t;
                k += 2;
                j += 2;
                continue;
            }
            let mut ny = nx as i64 - k;
            let mut nxm = nx;
            while nxm < n && (ny as usize) < m && a[nxm] == b[ny as usize] {
                nxm += 1;
                ny += 1;
            }
            let nx = nxm;
            v_cur[j] = (nx + 1) as $t;
            if nx == n && k == kend {
                done = true;
                break;
            }
            k += 2;
            j += 2;
        }
        trace.push(v_cur);
        if done {
            d_found = d;
            break;
        }
    }
    // Backtrack from (n, m).
    let mut ops = vec![0u8; n + m];
    let mut w = n + m;
    let mut x = n;
    let mut k = n as i64 - m as i64;
    for d in (1..=d_found).rev() {
        let v_prev = &trace[d - 1];
        let mut xd: i64 = -1;
        let mut xi: i64 = -1;
        if k > -(d as i64) {
            let v = v_prev[(k + d as i64 - 2) as usize];
            if v != 0 && (v as usize) <= n {
                xd = v as i64;
            }
        }
        if k < d as i64 {
            let v = v_prev[(k + d as i64) as usize];
            if v != 0 && (v as i64) - k - 2 < m as i64 {
                xi = v as i64 - 1;
            }
        }
        let by_deletion = xd >= 0 && (xi < 0 || xd >= xi);
        let x_post = if by_deletion { xd as usize } else { xi as usize };
        while x > x_post {
            x -= 1;
            w -= 1;
            ops[w] = KEEP;
        }
        if by_deletion {
            x -= 1;
            w -= 1;
            ops[w] = DELETE;
            k -= 1;
        } else {
            w -= 1;
            ops[w] = INSERT;
            k += 1;
        }
    }
    while x > 0 {
        x -= 1;
        w -= 1;
        ops[w] = KEEP;
    }
    ops.drain(..w);
    ops
}

    };
}
myers_ops_impl!(myers_ops_u16, u16);
myers_ops_impl!(myers_ops_u32, u32);

/// Myers edit ops, dispatching on the trace width.
fn myers_ops(a: &[u32], b: &[u32]) -> Vec<u8> {
    if a.len() < 65535 && b.len() < 65535 {
        myers_ops_u16(a, b)
    } else {
        myers_ops_u32(a, b)
    }
}

fn push_line(out: &mut Vec<u8>, op: u8, body: &[u8], has_nl: bool) {
    out.push(op);
    out.extend_from_slice(body);
    if has_nl {
        out.push(b'\n');
    } else {
        out.extend_from_slice(b"\n%\n");
    }
}

/// makefun-diff 1.0.0's patch of old into new, as bytes.
#[doc(hidden)]
pub fn diff_patch_pub(old: &[u8], new: &[u8]) -> Vec<u8> { diff_patch(old, new) }

fn diff_patch(old: &[u8], new: &[u8]) -> Vec<u8> {
    let mut ids: FxMap<&[u8], u32> = FxMap::default();
    let mut strs: Vec<&[u8]> = Vec::new();
    let a = tokenize(old, &mut ids, &mut strs);
    let b = tokenize(new, &mut ids, &mut strs);
    let n = a.len();
    let m = b.len();

    let mut prefix = 0usize;
    while prefix < n && prefix < m && a[prefix] == b[prefix] {
        prefix += 1;
    }
    let mut suffix = 0usize;
    while suffix < n - prefix && suffix < m - prefix && a[n - 1 - suffix] == b[m - 1 - suffix] {
        suffix += 1;
    }
    let mid_ops = if n - prefix - suffix == 0 && m - prefix - suffix == 0 {
        Vec::new()
    } else {
        myers_ops(&a[prefix..n - suffix], &b[prefix..m - suffix])
    };

    // Full op sequence.
    let mut ops: Vec<u8> = Vec::with_capacity(n + m);
    ops.resize(prefix, KEEP);
    ops.extend_from_slice(&mid_ops);
    ops.resize(ops.len() + suffix, KEEP);

    // Change runs.
    struct Change {
        o: usize,
        p: usize,
        dels: usize,
        ins: usize,
    }
    let mut changes: Vec<Change> = Vec::new();
    let mut o = 0usize;
    let mut p = 0usize;
    let mut deleted = 0usize;
    let mut inserted = 0usize;
    let mut cur: Option<usize> = None;
    for &op in ops.iter() {
        if op == KEEP {
            o += 1;
            p += 1;
            cur = None;
            continue;
        }
        if cur.is_none() {
            changes.push(Change { o, p, dels: 0, ins: 0 });
            cur = Some(changes.len() - 1);
        }
        let c = &mut changes[cur.unwrap()];
        if op == DELETE {
            c.dels += 1;
            o += 1;
            deleted += 1;
        } else {
            c.ins += 1;
            p += 1;
            inserted += 1;
        }
    }

    // Hunks: runs at most 6 kept lines apart share one.
    let mut hunks: Vec<Vec<usize>> = Vec::new();
    for (idx, ch) in changes.iter().enumerate() {
        let mut push_new = true;
        if let Some(h) = hunks.last_mut() {
            let prev = &changes[h[h.len() - 1]];
            if ch.o - (prev.o + prev.dels) <= 6 {
                h.push(idx);
                push_new = false;
            }
        }
        if push_new {
            hunks.push(vec![idx]);
        }
    }

    let mut out: Vec<u8> = Vec::with_capacity(n * 16);
    out.extend_from_slice(
        format!(
            "makefun-diff/1 old={} new={} hunks={} deleted={} inserted={}\n",
            n,
            m,
            hunks.len(),
            deleted,
            inserted
        )
        .as_bytes(),
    );
    let line_of = |out: &mut Vec<u8>, toks: &[u32], idx: usize, op: u8| {
        let t = toks[idx];
        let body = strs[(t >> 1) as usize];
        push_line(out, op, body, (t & 1) != 0);
    };
    for h in hunks.iter() {
        let first = &changes[h[0]];
        let last = &changes[h[h.len() - 1]];
        let old_start = first.o.saturating_sub(3);
        let new_start = first.p - (first.o - old_start);
        let after = 3.min(n - (last.o + last.dels));
        let old_end = last.o + last.dels + after;
        let new_end = last.p + last.ins + after;
        out.extend_from_slice(
            format!(
                "@ {} {} {} {}\n",
                old_start + 1,
                old_end - old_start,
                new_start + 1,
                new_end - new_start
            )
            .as_bytes(),
        );
        let mut at = old_start;
        for &ci in h.iter() {
            let ch = &changes[ci];
            while at < ch.o {
                line_of(&mut out, &a, at, b'=');
                at += 1;
            }
            for i in 0..ch.dels {
                line_of(&mut out, &a, ch.o + i, b'-');
            }
            for i in 0..ch.ins {
                line_of(&mut out, &b, ch.p + i, b'+');
            }
            at = ch.o + ch.dels;
        }
        while at < old_end {
            line_of(&mut out, &a, at, b'=');
            at += 1;
        }
    }
    out
}

// ---- C ABI: the JS side allocates input buffers, calls solve, reads [len u32 LE][bytes] ----
#[no_mangle]
pub extern "C" fn alloc(size: usize) -> *mut u8 {
    let mut v: Vec<u8> = Vec::with_capacity(size);
    let p = v.as_mut_ptr();
    std::mem::forget(v);
    p
}

#[no_mangle]
pub extern "C" fn solve(old_ptr: *const u8, old_len: usize, new_ptr: *const u8, new_len: usize) -> *mut u8 {
    let old = unsafe { std::slice::from_raw_parts(old_ptr, old_len) };
    let new = unsafe { std::slice::from_raw_parts(new_ptr, new_len) };
    let patch = diff_patch(old, new);
    let mut buf: Vec<u8> = Vec::with_capacity(patch.len() + 4);
    buf.extend_from_slice(&(patch.len() as u32).to_le_bytes());
    buf.extend_from_slice(&patch);
    let p = buf.as_mut_ptr();
    std::mem::forget(buf);
    p
}
