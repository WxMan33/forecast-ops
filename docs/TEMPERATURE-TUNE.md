# CVG pilot temperature adjustment, Nov. 5, 2026

User-authorized recipe `brad-scoped-temp-2026-11-05-v3` changes only first-48-hour 2-m temperature weights: HRRR 3→2.5, RRFS 3→2.5, RRFS ensemble 2→1.5, ECMWF ENS 3→4 and AIFS 0.75→1.25. The complete default temperature weight total remains 21. NWS, NBM and other source weights are unchanged. No temperature offset or teleconnection multiplier is applied. This is a provisional pilot adjustment, not established seasonal skill.

The custom selector exposes temperature, other first-48-hour fields, all later fields and entire-forecast editing. Existing saved general and later profiles are preserved during migration, with a versioned backup. The five revised temperature entries inherit their prior enabled/disabled state. Effective shares use actual variable-specific rules in charts, daily values, coverage and archived normalization.

The previous scoped recipe remains immutable. The new recipe is independently frozen and only applies prospectively from its effectiveFrom timestamp. The collector retains the original scoped comparison and adds a separate matched temperature-tuned comparison including both recipes. No captures are reconstructed or modified.
