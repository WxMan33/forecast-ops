# Reference: NCEP UPP Bourgouin precipitation type

`CALWXT_BOURG.f` is the original, unmodified file from NOAA-EMC/UPP:

- Repository: https://github.com/NOAA-EMC/UPP
- Path: `sorc/ncep_post.fd/CALWXT_BOURG.f`
- Commit: `76d5b18a3eb4be00db34decec2912c5f42c91337` (develop, fetched 2026-11-02)
- SHA-256: `db74db92c6617a31d6fb65015a5841d0235e8637d851cc6283e3c64afd19d4ad`
- License: UPP is distributed by NOAA-EMC under the GNU LGPL v3 (see the repository's LICENSE). This file is kept unmodified for testing only.

## How it is used

`.github/workflows/tests.yml` (job `upp`):

1. Verifies the SHA-256 above.
2. Builds a second copy, `CALWXT_BOURG_energy.f`, at build time. It has exactly two changes: the subroutine is renamed, and one `write` line before "decision tree time" prints `areape, areane, surfw, tlmhk`. The original routine does not output its energies. The original file is never edited.
3. Compiles both with `driver.f90` (gfortran, free form).
4. `cases.js` writes identical layer inputs for the Fortran (`cases.txt`) and for this site's code (`cases.json`): named profiles, fine sweeps across every threshold, and random profiles.
5. The driver runs the original routine with 8 random seeds per case. UPP draws randomly in its transition zones, so a mix zone shows up as a set of categories. It then runs the energy copy once.
6. `compare.js` compares the three energies case by case, then the categories. It fails on any energy outside tolerance, and on any category disagreement that energies within tolerance of a threshold don't explain.

The JavaScript port in `tests/reference/` is a separate, hand-written cross-check for offline use. It is not the original code.
