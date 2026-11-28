# Retrospective RRFS pilot: reproducibility check (fixed before running)

Committed 2026-11-27. The [ablation](ABLATION.md) baselines (run 46056850355) matched the [first scorecard](first/scorecard.md) to the reported precision, but not bit for bit. On identical HRRR inputs, the L-BFGS solver took different iteration counts (for example 172 vs 160). The ablation's exact-reproduction requirement was therefore missed.

## Local diagnosis (sandbox, same machine, synthetic cache)
The same data was run under different math-library settings:
- **Any one change alters the result:** the OpenBLAS thread count (1 vs 4), the OpenBLAS kernel (`OPENBLAS_CORETYPE=Haswell` vs auto), or numpy's SIMD dispatch (AVX-512 vs AVX2 via `NPY_DISABLE_CPU_FEATURES`). Each one changes iteration counts and prediction fingerprints.
- **No change, no difference:** repeated runs with identical settings were bit-identical.
- **Runners differ:** GitHub-hosted runners vary in CPU (Intel and AMD, with or without AVX-512), and earlier jobs ran 4 BLAS threads. That is the likely cause of the drift, but it has not yet been verified on runners. This check verifies it.

## Pinned numerical environment (used for this check and every later pilot test)
- `OPENBLAS_NUM_THREADS=1`, `OMP_NUM_THREADS=1`
- `OPENBLAS_CORETYPE=Haswell`: the same BLAS kernels on every x86-64 runner
- `NPY_DISABLE_CPU_FEATURES="AVX512F AVX512CD AVX512_SKX AVX512_CLX AVX512_CNL AVX512_ICL AVX512_SPR"`: numpy uses its AVX2 paths everywhere
- Unchanged: package versions (numpy 2.3.5, scipy 1.17.0, scikit-learn 1.9.1), the cache (run 46035459501), the recipe and the solver tolerance.

## Check
- **Four independent jobs**, each on a fresh runner, rerun the first comparison (`--experiment first`; arms `hrrr`, `rrfs`, `hrrr_rrfs`):
  - `pinned-1` and `pinned-2` use the pinned environment above;
  - `unpinned-1` and `unpinned-2` use the original setting (4 BLAS threads, auto kernels).
- **Recorded for each job:** CPU model, AVX-512 availability, active numpy features, BLAS version, threads and kernel. Also SHA-256 fingerprints of all held-out predictions per arm and of every fitted coefficient vector.
- **Pass:**
  - the two pinned jobs produce identical prediction and coefficient fingerprints, and identical results in every scope;
  - their CPUs and active numpy features are recorded, along with whether the two runners actually differed.
  - If the two pinned runners land on identical hardware, the match is reported as same-hardware evidence only.
- **Also reported:** the pinned results against the first scorecard, with the size of any difference. The unpinned jobs are reported against each other and against the first scorecard.

## If it passes
Later pilot tests use the pinned environment, and their baselines are checked by fingerprint as well as by value. Earlier scorecards stay as they are, with this check recorded.
