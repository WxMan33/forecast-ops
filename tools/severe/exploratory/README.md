# Exploratory severe analyses

Read-only analyses behind docs/severe-methods-review.md. They read only committed
2022–2024 labels, committed development scores and the committed live feed. They never
read 2025 outcomes, and they change no model, label or published file.

    pip install numpy==2.3.5 scipy==1.17.0 shapely==2.2.0
    python tools/severe/exploratory/offshore.py
    python tools/severe/exploratory/climatology.py

The land mask comes from assets/severe-research/states.json; offshore distances use a
local flat-earth approximation, which is adequate for the 25-mile cut.
