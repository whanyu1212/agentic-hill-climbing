import { OpenCode as OpenCodeClient } from "@opencode/client";
import { Service } from "@opencode/client/service";
import { OpenCode } from "@opencode/sdk";
import { MAX_SOURCE_BYTES, CandidateError } from "./executor";
import type { Score } from "./evaluate";

export interface Experiment {
  source?: string;
  search?: Score;
  error?: string;
}

export interface ProposalContext {
  currentSource: string;
  currentSearch: Score;
  feedback: { source: string; search: Score } | { rejected: true } | null;
}

export type Propose = (context: ProposalContext) => Promise<string>;

export function candidateSource(text: string): string {
  const trimmed = text.trim();
  const fenced = /^```(?:python)?\r?\n([\s\S]+?)\r?\n```$/.exec(trimmed);
  const source = fenced?.[1].trim() ?? trimmed;
  if (!source || Buffer.byteLength(source) > MAX_SOURCE_BYTES) {
    throw new CandidateError(
      "Candidate source is empty or exceeds the size limit.",
    );
  }
  return source;
}

export async function withOpenCode<T>(
  model: string,
  run: (propose: Propose) => Promise<T>,
  useLocalService = false,
): Promise<T> {
  if (useLocalService) {
    const endpoint = await Service.discover();
    if (!endpoint) throw new Error("No running local OpenCode service found.");
    const client = OpenCodeClient.make({
      baseUrl: endpoint.url,
      headers: Service.headers(endpoint),
    });
    return run(createProposer(client, model));
  }
  await using sdk = await OpenCode.create();
  // Keep the host alive until the last proposal and backtest have finished.
  return await run(createProposer(sdk, model));
}

function createProposer(
  client: Pick<OpenCode.Interface, "experimental">,
  model: string,
): Propose {
  const separator = model.indexOf("/");
  if (separator < 1 || separator === model.length - 1) {
    throw new Error("FORECAST_MODEL must be a provider/model identifier.");
  }
  return async (context) => {
    // One-shot generation has no session tools; the outer loop owns every trial.
    const { text } = await client.experimental.generate.text(
      {
        model: {
          providerID: model.slice(0, separator),
          id: model.slice(separator + 1),
        },
        prompt: [
          "Improve a seven-day NYC subway ridership forecast. Return only Python source.",
          "Define forecast(history, forecast_dates) and return seven nonnegative numbers in date order.",
          "history is a date-sorted list of dicts with ISO date strings and riders integers;",
          "it ends two calendar days before the forecast's first date. forecast_dates is a list of seven ISO strings.",
          "You can invent features and fit models using NumPy, pandas, SciPy, scikit-learn, or statsmodels.",
          "Compute calendar features from the ISO dates. Do not rely on network, files, or package installation.",
          "Minimize mean absolute error. Fit only on history; do not hard-code target-date predictions.",
          "The metrics below are from search backtests only; lower is better.",
          JSON.stringify(context),
        ].join("\n"),
      },
      { signal: AbortSignal.timeout(120_000) },
    );
    return candidateSource(text);
  };
}
