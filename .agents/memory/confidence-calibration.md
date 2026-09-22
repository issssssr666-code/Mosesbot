---
name: Confidence calibration
description: Decision boundary for any future active trading mode or confidence threshold.
---

The 90% confidence threshold must mean a statistically supported out-of-sample probability, not a heuristic score assembled from indicators. Until the calibration gate is eligible, existing paper-trading entries remain unchanged and no aggressive mode is activated.

**Why:** A technical confluence score can describe signal strength but cannot honestly claim a 90% win probability without independent validation and uncertainty bounds.

**How to apply:** Use a separate calibration report based on a chronological holdout of backtest trades. Require enough validation observations and a conservative lower confidence bound at or above 90% before allowing any future entry-policy change.