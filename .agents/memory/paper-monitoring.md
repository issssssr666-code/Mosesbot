---
name: Paper monitoring history
description: Durable rule for interpreting neutral paper-trading statistics.
---

Neutral scenario statistics are prospective only. Record each newly observed scenario with a uniqueness key and do not backfill neutral observations from older paper trades.

**Why:** Paper trades are created only for bullish and bearish scenarios, so the existing trade history cannot reveal which earlier candles were neutral without inventing historical data.

**How to apply:** Keep signal outcomes from saved paper-trade fields, use the observation journal for neutral counts, and treat an empty observation history as zero rather than reconstructing it.