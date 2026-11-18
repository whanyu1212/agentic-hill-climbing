import { expect, test } from "bun:test";
import { backtestFolds, forecastInput } from "./evaluate";
import { nextReplayStart, replaySnapshot } from "./snapshot";

const weeks = [
  "2026-09-21",
  "2026-09-28",
  "2026-10-05",
  "2026-10-12",
  "2026-10-19",
  "2026-10-26",
  "2026-11-02",
  "2026-11-09",
];

test("advances one replay week", () => {
  const keys: string[] = [];
  for (const week of weeks) {
    expect(nextReplayStart(keys)).toBe(week);
    const { history } = replaySnapshot;
    expect(forecastInput(history, week).forecast_dates).toHaveLength(7);
    expect(backtestFolds(history, week).promotion).toHaveLength(3);
    keys.push(`${week}.json`);
  }
  expect(nextReplayStart(keys)).toBeUndefined();
});

test("fills earliest unpublished week", () => {
  expect(nextReplayStart(["2026-11-09.json", "2026-09-21.json"])).toBe(
    "2026-09-28",
  );
});
