#[path = "../lib.rs"]
mod lib;
use std::time::Instant;
fn main() {
    let args: Vec<String> = std::env::args().collect();
    for id in ["g-0001","g-0002","g-0003","g-0004"] {
        let old = std::fs::read(format!("{}/{}.old", args[1], id)).unwrap();
        let new = std::fs::read(format!("{}/{}.new", args[1], id)).unwrap();
        for rep in 0..3 {
            let t0 = Instant::now();
            let out = lib::diff_patch_pub(&old, &new);
            let dt = t0.elapsed();
            println!("{} rep{} total_ms={:.1} out_len={}", id, rep, dt.as_secs_f64()*1000.0, out.len());
        }
    }
}
