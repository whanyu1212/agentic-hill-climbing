import {
  backtest,
  backtestFolds,
  forecastInput,
  mean,
  predict,
  type Score,
} from "./evaluate";
import { CandidateError, type ExecuteCandidate } from "./executor";
import type { Experiment, Propose, ProposalContext } from "./propose";
import type { Observation } from "./ridership";

export interface SavedForecast {
  asOf: string;
  source: string;
  dates: string[];
  forecast: number[];
  baselineForecast: number[];
}

interface WeeklyOptions {
  asOf: string;
  history: Observation[];
  baseline: string;
  previous?: SavedForecast;
  execute: ExecuteCandidate;
  propose?: Propose;
}

export function scorePublished(
  history: Observation[],
  published: SavedForecast,
) {
  const byDate = new Map(history.map(({ date, riders }) => [date, riders]));
  const actuals = published.dates.flatMap((date) => byDate.get(date) ?? []);
  if (actuals.length !== published.dates.length) return null;
  return {
    asOf: published.asOf,
    mae: mean(
      actuals.map((riders, i) => Math.abs(riders - published.forecast[i])),
    ),
    baselineMae: mean(
      actuals.map((riders, i) =>
        Math.abs(riders - published.baselineForecast[i]),
      ),
    ),
  };
}

export async function runWeek({
  asOf,
  history,
  baseline,
  previous,
  execute,
  propose,
}: WeeklyOptions) {
  const live = forecastInput(history, asOf);
  const { search, promotion } = backtestFolds(history, asOf);
  const original = previous?.source ?? baseline;
  const originalSearch = await backtest(execute, original, search);
  let bestSource = original;
  let bestSearch = originalSearch;
  let feedback: ProposalContext["feedback"] = null;
  const experiments: Experiment[] = [];

  if (propose) {
    for (let attempt = 0; attempt < 3; attempt++) {
      let source: string | undefined;
      try {
        source = await propose({
          currentSource: bestSource,
          currentSearch: bestSearch,
          feedback,
        });
        const score = await backtest(execute, source, search);
        experiments.push({ source, search: score });
        feedback = { source, search: score };
        if (score.mae < bestSearch.mae) {
          bestSource = source;
          bestSearch = score;
        }
      } catch (error) {
        if (!(error instanceof CandidateError)) throw error;
        experiments.push({ source, error: error.message });
        feedback = { rejected: true };
      }
    }
  }

  const incumbentScore = await backtest(execute, original, promotion);
  const baselineScore =
    original === baseline
      ? incumbentScore
      : await backtest(execute, baseline, promotion);
  let source = original;
  let candidateScore: Score | null = null;
  let candidateError: string | null = null;
  let forecast: number[] | undefined;
  // Only the search winner gets one look at the promotion folds.
  if (bestSource !== original) {
    try {
      candidateScore = await backtest(execute, bestSource, promotion);
      if (
        candidateScore.mae < Math.min(incumbentScore.mae, baselineScore.mae)
      ) {
        forecast = await predict(execute, bestSource, live);
        source = bestSource;
      }
    } catch (error) {
      if (!(error instanceof CandidateError)) throw error;
      candidateError = error.message;
    }
  }
  const baselineForecast = await predict(execute, baseline, live);
  if (!forecast) {
    forecast =
      source === baseline
        ? baselineForecast
        : await predict(execute, source, live);
  }
  return {
    asOf,
    source,
    dates: live.forecast_dates,
    forecast,
    baselineForecast,
    experiments,
    promoted: source !== original,
    promotion: {
      incumbentScore,
      baselineScore,
      candidateScore,
      candidateError,
    },
  };
}
