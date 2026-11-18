# Candidates

Each candidate is a standalone Python source file defining `forecast(history, forecast_dates)`. `history` is a date-sorted list of `{"date": "YYYY-MM-DD", "riders": 123}` rows and ends two days before the first target date. `forecast_dates` contains seven ISO dates. The candidate can derive calendar features and fit any model supported by the installed libraries. Return exactly seven finite, nonnegative predictions in date order.

[`baseline.py`](baseline.py) refits a blend of three simple predictors on each fold. The trusted evaluator owns the held-out actuals, MAE metric, and promotion decision. Run candidates only through the sandbox; do not load candidate code or model artifacts into the orchestrator.
