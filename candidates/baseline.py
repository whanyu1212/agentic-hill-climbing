"""Refit a single convex blend on the last eight weeks of observed data."""

from datetime import date, timedelta
from statistics import mean

from pandas.tseries.holiday import USFederalHolidayCalendar


def forecast(history, forecast_dates):
    counts = {date.fromisoformat(row["date"]): row["riders"] for row in history}
    first, last = min(counts), max(counts)
    holidays = {
        stamp.date()
        for stamp in USFederalHolidayCalendar().holidays(
            start=first, end=forecast_dates[-1]
        )
    }

    def base_predictions(day):
        lags = [
            counts[day - timedelta(weeks=week)]
            for week in range(1, 5)
            if day - timedelta(weeks=week) in counts
        ]
        typical = mean(lags)
        if day not in holidays:
            return lags[0], typical, typical

        ratios = []
        for holiday in sorted(holidays):
            prior = holiday - timedelta(weeks=1)
            if holiday < day and holiday in counts and counts.get(prior, 0) > 0:
                ratios.append(counts[holiday] / counts[prior])
        return lags[0], typical, typical * (mean(ratios[-10:]) if ratios else 1)

    training = [
        (base_predictions(day), counts[day])
        for day in sorted(counts)
        if last - timedelta(days=55) <= day <= last
    ]
    grid = [
        (first / 20, second / 20, (20 - first - second) / 20)
        for first in range(21)
        for second in range(21 - first)
    ]

    def blend(weights, predictions):
        return sum(
            weight * prediction for weight, prediction in zip(weights, predictions)
        )

    weights = min(
        grid,
        key=lambda weights: sum(
            abs(blend(weights, predictions) - riders)
            for predictions, riders in training
        ),
    )
    return [
        blend(weights, base_predictions(date.fromisoformat(day)))
        for day in forecast_dates
    ]
