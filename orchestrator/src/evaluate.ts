import {
  CandidateError,
  type ExecuteCandidate,
  type FoldInput,
} from "./executor";
import { addDays, datesFrom, HORIZON, type Observation } from "./ridership";

export interface Fold {
  input: FoldInput;
  actuals: number[];
}

export interface Score {
  mae: number;
  weekdayMae: number;
  weekendMae: number;
}

const PUBLICATION_LAG_DAYS = 2;
const MIN_HISTORY_DAYS = 84;

export function forecastInput(
  history: Observation[],
  start: string,
): FoldInput {
  const cutoff = addDays(start, -PUBLICATION_LAG_DAYS);
  const training = history.filter(({ date }) => date <= cutoff);
  const recent = training.slice(-MIN_HISTORY_DAYS);
  if (
    recent.length !== MIN_HISTORY_DAYS ||
    !recent.every(
      ({ date }, index) =>
        date === addDays(cutoff, index - MIN_HISTORY_DAYS + 1),
    )
  ) {
    throw new Error(`Ridership history is incomplete through ${cutoff}.`);
  }
  return { history: training, forecast_dates: datesFrom(start) };
}

export function backtestFolds(
  history: Observation[],
  asOf: string,
): {
  search: Fold[];
  promotion: Fold[];
} {
  const byDate = new Map(history.map(({ date, riders }) => [date, riders]));
  const folds = Array.from({ length: 7 }, (_, index) => {
    const start = addDays(asOf, -(8 - index) * HORIZON);
    const input = forecastInput(history, start);
    const actuals = input.forecast_dates.map((date) => {
      const riders = byDate.get(date);
      if (riders === undefined)
        throw new Error(`No backtest observation for ${date}.`);
      return riders;
    });
    return { input, actuals };
  });
  return { search: folds.slice(0, 4), promotion: folds.slice(4) };
}

export async function predict(
  execute: ExecuteCandidate,
  source: string,
  input: FoldInput,
): Promise<number[]> {
  const value = await execute(source, input);
  if (
    !Array.isArray(value) ||
    value.length !== HORIZON ||
    !value.every(
      (prediction: unknown) =>
        typeof prediction === "number" &&
        Number.isFinite(prediction) &&
        prediction >= 0 &&
        prediction <= Number.MAX_SAFE_INTEGER,
    )
  ) {
    throw new CandidateError(
      `Expected ${HORIZON} finite, nonnegative predictions.`,
    );
  }
  return value;
}

export async function backtest(
  execute: ExecuteCandidate,
  source: string,
  folds: Fold[],
): Promise<Score> {
  const weekdays: number[] = [];
  const weekends: number[] = [];
  for (const { input, actuals } of folds) {
    const predictions = await predict(execute, source, input);
    for (const [index, date] of input.forecast_dates.entries()) {
      const day = new Date(`${date}T00:00:00Z`).getUTCDay();
      const errors = day === 0 || day === 6 ? weekends : weekdays;
      errors.push(Math.abs(predictions[index] - actuals[index]));
    }
  }
  return {
    mae: mean([...weekdays, ...weekends]),
    weekdayMae: mean(weekdays),
    weekendMae: mean(weekends),
  };
}

export function mean(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}
