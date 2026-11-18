import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { localArtifacts } from "./artifacts";
import { backtestFolds, forecastInput, predict } from "./evaluate";
import type { ExecuteCandidate } from "./executor";
import { candidateSource } from "./propose";
import { addDays, datesFrom, observations } from "./ridership";
import { runWeek, scorePublished } from "./weekly";

const asOf = "2026-09-07";
const history = Array.from({ length: 240 }, (_, index) => ({
  date: addDays(asOf, index - 240),
  riders: 100,
}));

test("hides observations after cutoff", () => {
  const { search, promotion } = backtestFolds(history, asOf);
  expect(search).toHaveLength(4);
  expect(promotion).toHaveLength(3);
  expect(search.at(-1)?.input.forecast_dates.at(-1)).toBe("2026-08-09");
  expect(promotion[0].input.forecast_dates[0]).toBe("2026-08-10");
  expect(promotion[0].input.history.at(-1)?.date).toBe("2026-08-08");
  expect(promotion[0].actuals).toEqual(Array(7).fill(100));
});

test("rejects a recent gap", () => {
  const missing = history.filter(({ date }) => date !== "2026-09-05");
  expect(() => forecastInput(missing, asOf)).toThrow("incomplete");
});

test.each([
  [null],
  [[100]],
  [[100, 100, 100, 100, 100, 100, Infinity]],
  [Array(7).fill(-1)],
])("rejects invalid forecast %#", async (value) => {
  await expect(
    predict(async () => value, "", forecastInput(history, asOf)),
  ).rejects.toThrow("7 finite");
});

test("runs only the winner on holdout", async () => {
  const visited: [string, string][] = [];
  const execute: ExecuteCandidate = async (source, input) => {
    visited.push([source, input.forecast_dates[0]]);
    const riders = source === "best" ? 100 : source === "worse" ? 200 : 150;
    return Array(7).fill(riders);
  };
  const candidates = ["best", "worse", "worse"];
  const result = await runWeek({
    asOf,
    history,
    baseline: "baseline",
    execute,
    propose: async () => candidates.shift() ?? "worse",
  });

  const { promotion } = backtestFolds(history, asOf);
  const holdoutDates = new Set(
    promotion.map(({ input }) => input.forecast_dates[0]),
  );
  expect(
    visited
      .filter(([, date]) => holdoutDates.has(date))
      .map(([source]) => source),
  ).toEqual(["baseline", "baseline", "baseline", "best", "best", "best"]);
  expect(result.promoted).toBe(true);
  expect(result.forecast).toEqual(Array(7).fill(100));
  expect(result.baselineForecast).toEqual(Array(7).fill(150));
});

test("rejects a holdout regression", async () => {
  const execute: ExecuteCandidate = async (source, input) =>
    Array(7).fill(
      source === "baseline"
        ? 150
        : input.forecast_dates[0] < "2026-08-10"
          ? 100
          : 200,
    );
  const result = await runWeek({
    asOf,
    history,
    baseline: "baseline",
    execute,
    propose: async () => "overfit",
  });
  expect(result.source).toBe("baseline");
  expect(result.experiments[0].search?.mae).toBe(0);
  expect(result.promotion.candidateScore?.mae).toBe(100);
});

test("scores only completed forecasts", () => {
  const start = addDays(asOf, -7);
  const saved = {
    asOf: start,
    dates: datesFrom(start),
    source: "model",
    forecast: Array(7).fill(120),
    baselineForecast: Array(7).fill(150),
  };
  expect(scorePublished(history.slice(0, -1), saved)).toBeNull();
  expect(scorePublished(history, saved)).toEqual({
    asOf: start,
    mae: 20,
    baselineMae: 50,
  });
});

test("publishes artifacts only once", async () => {
  const folder = await mkdtemp(join(tmpdir(), "hill-climb-test-"));
  try {
    const store = await localArtifacts(folder);
    const key = `${asOf}.json`;
    const original = {
      asOf,
      dates: datesFrom(asOf),
      source: "original",
      forecast: Array(7).fill(100),
      baselineForecast: Array(7).fill(150),
    };
    expect(await store.publish(key, original)).toBe(true);
    expect(await store.publish(key, { ...original, source: "different" })).toBe(
      false,
    );
    expect(await store.list()).toEqual([key]);
    expect(await store.read(key)).toEqual(original);
  } finally {
    await rm(folder, { recursive: true });
  }
});

test("parses and sorts observations", () => {
  const row = { date: "2026-04-02T00:00:00.000", count: "123" };
  expect(observations([row, { date: "2026-04-01", count: "0" }])).toEqual([
    { date: "2026-04-01", riders: 0 },
    { date: "2026-04-02", riders: 123 },
  ]);
  expect(() => observations([row, row])).toThrow("duplicate");
});

test("unwraps a Python fence", () => {
  expect(candidateSource("```python\nprint(1)\n```")).toBe("print(1)");
  expect(() => candidateSource(" \n ")).toThrow("empty");
});
