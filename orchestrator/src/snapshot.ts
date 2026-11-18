import snapshot from "../data/mta-subway-2026-11-15.json";
import { addDays, HORIZON } from "./ridership";

const CAMPAIGN_WEEKS = 8;
const defaultStart = addDays(
  snapshot.firstDate,
  snapshot.counts.length - HORIZON,
);

export const replaySnapshot = {
  id: snapshot.id,
  defaultStart,
  history: snapshot.counts.map((riders, index) => ({
    date: addDays(snapshot.firstDate, index),
    riders,
  })),
};

export function nextReplayStart(
  publishedKeys: readonly string[],
): string | undefined {
  const published = new Set(publishedKeys);
  return Array.from({ length: CAMPAIGN_WEEKS }, (_, index) =>
    addDays(defaultStart, (index + 1 - CAMPAIGN_WEEKS) * HORIZON),
  ).find((start) => !published.has(`${start}.json`));
}
