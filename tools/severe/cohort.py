"""Validate the outcome-independent calendar cohorts before data access."""
from protocol import PROTOCOL, SCHEMA


def calendar_cases(config):
    if (config["protocol"] != PROTOCOL or config["feature_schema"] != SCHEMA
            or [config[key] for key in ("training_year", "calibration_year", "development_year",
                                       "protected_outcome_year")] != [2022, 2023, 2024, 2025]):
        raise ValueError("Incompatible cohort protocol or year split")
    selection = config.get("calendar_selection", "monthly-15")
    if selection not in ("monthly-15", "expanded-training-1-8-15-22"):
        raise ValueError("Unsupported frozen calendar")
    cases = []
    for year in (2022, 2023, 2024):
        days = (1, 8, 15, 22) if selection == "expanded-training-1-8-15-22" and year < 2024 else (15,)
        cases.extend(f"{year}-{month:02d}-{day:02d}" for month in range(1, 13) for day in days)
    if config["cases"] != cases:
        raise ValueError("Dates differ from the frozen calendar")
    return cases
