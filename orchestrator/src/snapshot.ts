import snapshot from "../data/mta-subway-2026-11-15.json";
import { addDays, HORIZON } from "./ridership";

export const replaySnapshot = {
  id: snapshot.id,
  defaultStart: addDays(snapshot.firstDate, snapshot.counts.length - HORIZON),
  history: snapshot.counts.map((riders, index) => ({
    date: addDays(snapshot.firstDate, index),
    riders,
  })),
};
